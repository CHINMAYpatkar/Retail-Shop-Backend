import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { derivePaymentStatus } from '../purchase-bills/material-costing';
import { CreateVendorPaymentDto } from './dto/create-vendor-payment.dto';
import { UpdateVendorPaymentDto } from './dto/update-vendor-payment.dto';
import { QueryVendorPaymentsDto } from './dto/query-vendor-payments.dto';

const PAYMENT_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  purchaseBill: { select: { id: true, billNumber: true, billDate: true, totalAmount: true } },
} satisfies Prisma.VendorPaymentInclude;

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class VendorPaymentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryVendorPaymentsDto) {
    const {
      page = 1,
      limit = 20,
      search,
      vendorId,
      purchaseBillId,
      method,
      onAccountOnly,
      fromDate,
      toDate,
    } = query;

    const where: Prisma.VendorPaymentWhereInput = {
      ...(vendorId ? { vendorId } : {}),
      ...(purchaseBillId ? { purchaseBillId } : {}),
      ...(method ? { method } : {}),
      ...(onAccountOnly ? { purchaseBillId: null } : {}),
      ...(fromDate || toDate
        ? {
            paidOn: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { referenceNo: { contains: search, mode: 'insensitive' } },
              { vendor: { name: { contains: search, mode: 'insensitive' } } },
              { purchaseBill: { billNumber: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vendorPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vendorPayment.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const payment = await this.prisma.vendorPayment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async create(dto: CreateVendorPaymentDto, adminId?: string) {
    await this.assertVendorExists(dto.vendorId);

    if (dto.purchaseBillId) {
      await this.assertPaymentFitsBill(
        dto.purchaseBillId,
        dto.vendorId,
        new Prisma.Decimal(dto.amount),
      );
    }

    return this.prisma.vendorPayment.create({
      data: {
        vendorId: dto.vendorId,
        purchaseBillId: dto.purchaseBillId,
        amount: new Prisma.Decimal(dto.amount),
        paidOn: new Date(dto.paidOn),
        method: dto.method,
        referenceNo: dto.referenceNo,
        attachmentMediaId: dto.attachmentMediaId,
        notes: dto.notes,
        createdByAdminId: adminId,
      },
      include: PAYMENT_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateVendorPaymentDto) {
    const existing = await this.findOne(id);

    const vendorId = dto.vendorId ?? existing.vendorId;
    if (dto.vendorId && dto.vendorId !== existing.vendorId) {
      await this.assertVendorExists(dto.vendorId);
    }

    const billId = dto.purchaseBillId === undefined ? existing.purchaseBillId : dto.purchaseBillId;
    const amount = dto.amount === undefined ? existing.amount : new Prisma.Decimal(dto.amount);

    if (billId) {
      // This payment is excluded from the outstanding calculation: otherwise
      // editing it without changing the amount would always fail, since its own
      // value already counts against the bill.
      await this.assertPaymentFitsBill(billId, vendorId, amount, id);
    }

    return this.prisma.vendorPayment.update({
      where: { id },
      data: {
        vendorId,
        purchaseBillId: billId,
        amount,
        paidOn: dto.paidOn ? new Date(dto.paidOn) : existing.paidOn,
        method: dto.method ?? existing.method,
        referenceNo: dto.referenceNo === undefined ? existing.referenceNo : dto.referenceNo,
        attachmentMediaId:
          dto.attachmentMediaId === undefined ? existing.attachmentMediaId : dto.attachmentMediaId,
        notes: dto.notes === undefined ? existing.notes : dto.notes,
      },
      include: PAYMENT_INCLUDE,
    });
  }

  /**
   * Deleting is how a keying error gets corrected, so it is allowed - unlike a
   * customer refund, no external party depends on this record existing. The
   * affected bill's status re-derives on the next read.
   */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.vendorPayment.delete({ where: { id } });
    return { message: 'Payment deleted' };
  }

  private async assertVendorExists(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
  }

  /**
   * A bill-linked payment cannot exceed what is still outstanding on that bill,
   * and cannot be attached to another vendor's bill.
   *
   * Over-payment is blocked rather than tolerated: it would make the vendor
   * balance and every payables report disagree with reality, and the correct way
   * to record extra money is an on-account payment.
   */
  private async assertPaymentFitsBill(
    billId: string,
    vendorId: string,
    amount: Prisma.Decimal,
    exceptPaymentId?: string,
  ) {
    const bill = await this.prisma.purchaseBill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        vendorId: true,
        billNumber: true,
        totalAmount: true,
        payments: {
          where: exceptPaymentId ? { id: { not: exceptPaymentId } } : undefined,
          select: { amount: true },
        },
      },
    });

    if (!bill) throw new NotFoundException('Purchase bill not found');

    if (bill.vendorId !== vendorId) {
      throw new BadRequestException('That bill belongs to a different vendor');
    }

    const alreadyPaid = bill.payments.reduce((acc, p) => acc.add(p.amount), ZERO);
    const outstanding = bill.totalAmount.sub(alreadyPaid);

    if (amount.gt(outstanding)) {
      throw new BadRequestException(
        `Payment of ${amount.toFixed(2)} exceeds the ${outstanding.toFixed(2)} outstanding on bill "${bill.billNumber}". Record the excess as an on-account payment instead (leave the bill blank).`,
      );
    }
  }

  /**
   * Everything owed to one vendor, as a chronological statement.
   *
   * Bills increase the balance, payments reduce it. The running balance is
   * computed here rather than stored, for the same reason the vendor balance
   * is: a stored figure is wrong the moment any bill or payment is edited.
   */
  async ledger(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [bills, payments] = await this.prisma.$transaction([
      this.prisma.purchaseBill.findMany({
        where: { vendorId },
        select: {
          id: true,
          billNumber: true,
          billDate: true,
          dueDate: true,
          totalAmount: true,
          payments: { select: { amount: true } },
        },
        orderBy: { billDate: 'asc' },
      }),
      this.prisma.vendorPayment.findMany({
        where: { vendorId },
        select: {
          id: true,
          paidOn: true,
          amount: true,
          method: true,
          referenceNo: true,
          purchaseBill: { select: { id: true, billNumber: true } },
        },
        orderBy: { paidOn: 'asc' },
      }),
    ]);

    const totalBilled = bills.reduce((acc, b) => acc.add(b.totalAmount), ZERO);
    const totalPaid = payments.reduce((acc, p) => acc.add(p.amount), ZERO);
    const onAccount = payments
      .filter((p) => !p.purchaseBill)
      .reduce((acc, p) => acc.add(p.amount), ZERO);

    const billSummaries = bills.map((bill) => {
      const paid = bill.payments.reduce((acc, p) => acc.add(p.amount), ZERO);
      return {
        id: bill.id,
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        totalAmount: bill.totalAmount,
        paidAmount: paid,
        outstandingAmount: bill.totalAmount.sub(paid),
        status: derivePaymentStatus(bill.totalAmount, paid),
      };
    });

    // Merged into one dated stream so the balance reads like a statement. Bills
    // sort before payments on the same day: you are billed, then you pay.
    const entries = [
      ...bills.map((b) => ({
        kind: 'BILL' as const,
        date: b.billDate,
        reference: b.billNumber,
        billId: b.id as string | null,
        billNumber: b.billNumber as string | null,
        debit: b.totalAmount,
        credit: ZERO,
      })),
      ...payments.map((p) => ({
        kind: 'PAYMENT' as const,
        date: p.paidOn,
        reference: p.referenceNo || p.method,
        billId: p.purchaseBill?.id ?? null,
        billNumber: p.purchaseBill?.billNumber ?? null,
        debit: ZERO,
        credit: p.amount,
      })),
    ].sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      return a.kind === 'BILL' ? -1 : 1;
    });

    let balance = ZERO;
    const withBalance = entries.map((entry) => {
      balance = balance.add(entry.debit).sub(entry.credit);
      return { ...entry, balance };
    });

    const unpaid = billSummaries.filter((b) => b.outstandingAmount.gt(0));

    return {
      vendor,
      summary: {
        totalBilled,
        totalPaid,
        // Positive means money is owed to the vendor; negative means they are
        // holding an advance from us.
        outstanding: totalBilled.sub(totalPaid),
        onAccount,
        billCount: bills.length,
        unpaidBillCount: unpaid.length,
        oldestUnpaidBillDate: unpaid.length ? unpaid[0].billDate : null,
      },
      bills: billSummaries,
      payments,
      entries: withBalance,
    };
  }
}
