import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  billTotals,
  derivePaymentStatus,
  lineTotal,
  weightedAverageCost,
} from './material-costing';
import { CreatePurchaseBillDto, PurchaseBillItemDto } from './dto/create-purchase-bill.dto';
import { UpdatePurchaseBillDto } from './dto/update-purchase-bill.dto';
import { QueryPurchaseBillsDto } from './dto/query-purchase-bills.dto';

const BILL_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  items: {
    include: { rawMaterial: { select: { id: true, name: true, code: true, baseUnit: true } } },
  },
  payments: { select: { id: true, amount: true, paidOn: true, method: true } },
} satisfies Prisma.PurchaseBillInclude;

type BillWithRelations = Prisma.PurchaseBillGetPayload<{ include: typeof BILL_INCLUDE }>;

@Injectable()
export class PurchaseBillsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryPurchaseBillsDto) {
    const { page = 1, limit = 20, search, vendorId, fromDate, toDate } = query;

    const where: Prisma.PurchaseBillWhereInput = {
      ...(vendorId ? { vendorId } : {}),
      ...(fromDate || toDate
        ? {
            billDate: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { billNumber: { contains: search, mode: 'insensitive' } },
              { vendor: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseBill.findMany({
        where,
        include: BILL_INCLUDE,
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseBill.count({ where }),
    ]);

    return {
      items: items.map((bill) => this.withDerivedFields(bill)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const bill = await this.prisma.purchaseBill.findUnique({
      where: { id },
      include: BILL_INCLUDE,
    });
    if (!bill) throw new NotFoundException('Purchase bill not found');
    return this.withDerivedFields(bill);
  }

  /**
   * Records a bill and its effect on stock, in one transaction.
   *
   * Everything here either happens together or not at all: a bill that saved
   * while its stock increment failed would silently understate inventory.
   */
  async create(dto: CreatePurchaseBillDto, adminId?: string) {
    await this.assertVendorExists(dto.vendorId);
    await this.assertBillNumberAvailable(dto.vendorId, dto.billNumber);
    await this.assertMaterialsExist(dto.items);

    this.assertDueDateNotBeforeBillDate(
      new Date(dto.billDate),
      dto.dueDate ? new Date(dto.dueDate) : null,
    );

    const lines = this.buildLines(dto.items);
    const { subtotal, totalAmount } = billTotals(
      lines,
      new Prisma.Decimal(dto.taxAmount ?? 0),
      new Prisma.Decimal(dto.discountAmount ?? 0),
    );

    const bill = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseBill.create({
        data: {
          vendorId: dto.vendorId,
          billNumber: dto.billNumber.trim(),
          billDate: new Date(dto.billDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          taxAmount: new Prisma.Decimal(dto.taxAmount ?? 0),
          discountAmount: new Prisma.Decimal(dto.discountAmount ?? 0),
          subtotal,
          totalAmount,
          attachmentMediaId: dto.attachmentMediaId,
          notes: dto.notes,
          createdByAdminId: adminId,
          items: { create: lines },
        },
      });

      await this.applyStockDeltas(tx, lines, 'add');
      await this.recomputeMaterialCosts(tx, this.materialIdsOf(lines));

      return created;
    });

    return this.findOne(bill.id);
  }

  /**
   * Reverses the bill's original stock effect, then applies the new one.
   *
   * This is the routine most likely to corrupt data silently - a partial
   * reversal leaves stock and cost quietly wrong, and unlike a broken order
   * there is no customer to complain. Hence: one transaction, full reversal
   * before re-application, and costs recomputed from history for every material
   * touched by EITHER version of the bill.
   */
  async update(id: string, dto: UpdatePurchaseBillDto, adminId?: string) {
    const existing = await this.prisma.purchaseBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Purchase bill not found');

    if (dto.vendorId && dto.vendorId !== existing.vendorId) {
      await this.assertVendorExists(dto.vendorId);
    }
    if (dto.billNumber && dto.billNumber !== existing.billNumber) {
      await this.assertBillNumberAvailable(dto.vendorId ?? existing.vendorId, dto.billNumber, id);
    }

    // The effective pair, not just what was sent: changing only the bill date
    // can invalidate a due date that was fine before, and vice versa.
    this.assertDueDateNotBeforeBillDate(
      dto.billDate ? new Date(dto.billDate) : existing.billDate,
      dto.dueDate === undefined ? existing.dueDate : dto.dueDate ? new Date(dto.dueDate) : null,
    );

    const replacingItems = dto.items !== undefined;
    if (replacingItems) await this.assertMaterialsExist(dto.items!);

    const newLines = replacingItems ? this.buildLines(dto.items!) : existing.items;
    const { subtotal, totalAmount } = billTotals(
      newLines,
      new Prisma.Decimal(dto.taxAmount ?? existing.taxAmount),
      new Prisma.Decimal(dto.discountAmount ?? existing.discountAmount),
    );

    // Every material in the old bill OR the new one needs recomputing: one
    // removed by this edit must stop contributing to its own average.
    const affected = new Set([
      ...this.materialIdsOf(existing.items),
      ...this.materialIdsOf(newLines),
    ]);

    await this.prisma.$transaction(async (tx) => {
      if (replacingItems) {
        await this.applyStockDeltas(tx, existing.items, 'subtract');
        await tx.purchaseBillItem.deleteMany({ where: { purchaseBillId: id } });
      }

      await tx.purchaseBill.update({
        where: { id },
        data: {
          vendorId: dto.vendorId ?? existing.vendorId,
          billNumber: dto.billNumber?.trim() ?? existing.billNumber,
          billDate: dto.billDate ? new Date(dto.billDate) : existing.billDate,
          dueDate:
            dto.dueDate === undefined
              ? existing.dueDate
              : dto.dueDate
                ? new Date(dto.dueDate)
                : null,
          taxAmount: new Prisma.Decimal(dto.taxAmount ?? existing.taxAmount),
          discountAmount: new Prisma.Decimal(dto.discountAmount ?? existing.discountAmount),
          subtotal,
          totalAmount,
          attachmentMediaId:
            dto.attachmentMediaId === undefined
              ? existing.attachmentMediaId
              : dto.attachmentMediaId,
          notes: dto.notes === undefined ? existing.notes : dto.notes,
          createdByAdminId: existing.createdByAdminId ?? adminId,
          ...(replacingItems ? { items: { create: newLines } } : {}),
        },
      });

      if (replacingItems) await this.applyStockDeltas(tx, newLines, 'add');
      await this.recomputeMaterialCosts(tx, [...affected]);
    });

    return this.findOne(id);
  }

  /** Removes the bill and reverses its stock effect. Refused once payments exist. */
  async remove(id: string) {
    const existing = await this.prisma.purchaseBill.findUnique({
      where: { id },
      include: { items: true, _count: { select: { payments: true } } },
    });
    if (!existing) throw new NotFoundException('Purchase bill not found');

    if (existing._count.payments > 0) {
      throw new ConflictException(
        `Cannot delete this bill because ${existing._count.payments} payment(s) are recorded against it. Delete those payments first.`,
      );
    }

    const affected = this.materialIdsOf(existing.items);

    await this.prisma.$transaction(async (tx) => {
      await this.applyStockDeltas(tx, existing.items, 'subtract');
      await tx.purchaseBill.delete({ where: { id } });
      await this.recomputeMaterialCosts(tx, affected);
    });

    return { message: 'Purchase bill deleted' };
  }

  // ---------- internals ----------

  private buildLines(items: PurchaseBillItemDto[]) {
    if (!items.length) {
      throw new BadRequestException('A purchase bill needs at least one line item');
    }

    return items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      return {
        rawMaterialId: item.rawMaterialId,
        quantity,
        unitPrice,
        // Never taken from the client - see material-costing.ts
        lineTotal: lineTotal(quantity, unitPrice),
        notes: item.notes,
      };
    });
  }

  private materialIdsOf(lines: { rawMaterialId: string }[]): string[] {
    return [...new Set(lines.map((l) => l.rawMaterialId))];
  }

  private async applyStockDeltas(
    tx: Prisma.TransactionClient,
    lines: { rawMaterialId: string; quantity: Prisma.Decimal }[],
    direction: 'add' | 'subtract',
  ) {
    // Summed per material first: a bill may legitimately list the same material
    // twice at different prices, and one update per material is easier to reason
    // about than two competing increments.
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const current = totals.get(line.rawMaterialId) ?? new Prisma.Decimal(0);
      totals.set(line.rawMaterialId, current.add(line.quantity));
    }

    for (const [rawMaterialId, quantity] of totals) {
      await tx.rawMaterial.update({
        where: { id: rawMaterialId },
        data: {
          stockQuantity: direction === 'add' ? { increment: quantity } : { decrement: quantity },
        },
      });
    }
  }

  /**
   * Recomputes average cost from each material's full purchase history.
   *
   * Deliberately not a reverse-subtraction: a moving average cannot be exactly
   * un-applied, so subtracting would drift on every bill edit. See
   * material-costing.ts for the full reasoning.
   */
  private async recomputeMaterialCosts(tx: Prisma.TransactionClient, materialIds: string[]) {
    for (const rawMaterialId of materialIds) {
      const history = await tx.purchaseBillItem.findMany({
        where: { rawMaterialId },
        select: { quantity: true, unitPrice: true },
        orderBy: { purchaseBill: { billDate: 'asc' } },
      });

      const average = weightedAverageCost(history);

      await tx.rawMaterial.update({
        where: { id: rawMaterialId },
        data: {
          // null means no purchase history remains - keep whatever opening cost
          // was entered by hand rather than blanking it.
          ...(average === null ? {} : { avgCostPerUnit: average }),
          ...(history.length ? { lastPurchasePrice: history[history.length - 1].unitPrice } : {}),
        },
      });
    }
  }

  private withDerivedFields(bill: BillWithRelations) {
    const paidAmount = bill.payments
      .reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0))
      .toDecimalPlaces(2);

    return {
      ...bill,
      paidAmount,
      outstandingAmount: bill.totalAmount.sub(paidAmount).toDecimalPlaces(2),
      status: derivePaymentStatus(bill.totalAmount, paidAmount),
    };
  }

  private async assertVendorExists(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
  }

  private async assertBillNumberAvailable(vendorId: string, billNumber: string, exceptId?: string) {
    const existing = await this.prisma.purchaseBill.findFirst({
      where: {
        vendorId,
        billNumber: billNumber.trim(),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    // Catches the same paper bill being keyed in twice, which would
    // double-count both the spend and the stock.
    if (existing) {
      throw new ConflictException(
        `Bill number "${billNumber}" has already been recorded for this vendor`,
      );
    }
  }

  /**
   * A bill cannot fall due before it was issued.
   *
   * Same-day is allowed - payable on receipt is normal. Only strictly earlier
   * is rejected, and it is rejected here rather than only in the UI, because
   * the date pair is the kind of thing an import or a direct API call would
   * otherwise sail straight past.
   */
  private assertDueDateNotBeforeBillDate(billDate: Date, dueDate: Date | null) {
    if (!dueDate) return;

    // Compared by calendar day: both arrive as midnight UTC from a date input,
    // but a timestamp difference within the same day is not a real conflict.
    const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

    if (day(dueDate) < day(billDate)) {
      throw new BadRequestException(
        `Due date (${dueDate.toISOString().slice(0, 10)}) cannot be earlier than the bill date (${billDate
          .toISOString()
          .slice(0, 10)})`,
      );
    }
  }

  private async assertMaterialsExist(items: PurchaseBillItemDto[]) {
    const ids = [...new Set(items.map((i) => i.rawMaterialId))];
    const found = await this.prisma.rawMaterial.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new NotFoundException('One or more raw materials on this bill no longer exist');
    }
  }
}
