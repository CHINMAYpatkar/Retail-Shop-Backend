import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { computeMargin, lineCost, sheetTotals } from './cost-sheet-maths';
import { CostSheetItemDto, CreateCostSheetDto } from './dto/create-cost-sheet.dto';
import { UpdateCostSheetDto } from './dto/update-cost-sheet.dto';

const SHEET_INCLUDE = {
  items: {
    include: {
      rawMaterial: {
        select: { id: true, name: true, code: true, baseUnit: true, avgCostPerUnit: true },
      },
    },
  },
} satisfies Prisma.ProductCostSheetInclude;

const ZERO = new Prisma.Decimal(0);

export interface CostedProduct {
  id: string;
  name: string;
  sku: string | null;
  isActive: boolean;
  costSheetId: string;
  costSheetVersion: number;
  sellingPrice: Prisma.Decimal;
  costPerUnit: Prisma.Decimal;
  marginAmount: Prisma.Decimal;
  marginPercent: Prisma.Decimal | null;
}

export interface UncostedProduct {
  id: string;
  name: string;
  sku: string | null;
  price: Prisma.Decimal;
}

@Injectable()
export class CostingService {
  constructor(private prisma: PrismaService) {}

  /** Every version for a product, newest first. */
  async findAllForProduct(productId: string) {
    await this.assertProductExists(productId);

    return this.prisma.productCostSheet.findMany({
      where: { productId },
      include: SHEET_INCLUDE,
      orderBy: { version: 'desc' },
    });
  }

  async findOne(id: string) {
    const sheet = await this.prisma.productCostSheet.findUnique({
      where: { id },
      include: SHEET_INCLUDE,
    });
    if (!sheet) throw new NotFoundException('Cost sheet not found');
    return sheet;
  }

  /**
   * Creates the next version and deactivates the previous active one.
   *
   * A new version rather than an edit, because a cost sheet answers "what did
   * this cost us at the time?" - overwriting would silently rewrite history.
   * `update()` exists only to correct a mistake in the current version.
   */
  async create(productId: string, dto: CreateCostSheetDto, adminId?: string) {
    await this.assertProductExists(productId);
    const lines = await this.buildLines(dto.items);

    const making = this.makingCosts(dto);
    const totals = sheetTotals(lines, making, dto.batchYieldQuantity);

    const latest = await this.prisma.productCostSheet.findFirst({
      where: { productId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const sheet = await this.prisma.$transaction(async (tx) => {
      // Exactly one active sheet per product - the invariant that margin
      // reporting and the checkout cost snapshot both depend on.
      await tx.productCostSheet.updateMany({
        where: { productId, isActive: true },
        data: { isActive: false },
      });

      return tx.productCostSheet.create({
        data: {
          productId,
          version,
          isActive: true,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
          batchYieldQuantity: dto.batchYieldQuantity,
          ...making,
          materialCost: totals.materialCost,
          totalBatchCost: totals.totalBatchCost,
          costPerUnit: totals.costPerUnit,
          notes: dto.notes,
          createdByAdminId: adminId,
          items: { create: lines },
        },
      });
    });

    return this.findOne(sheet.id);
  }

  /**
   * Corrects the current version in place.
   *
   * Items are replaced wholesale when supplied, matching product images and bill
   * lines: the form always sends complete state, so diffing would add
   * complexity for no gain.
   */
  async update(id: string, dto: UpdateCostSheetDto) {
    const existing = await this.prisma.productCostSheet.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Cost sheet not found');

    const replacingItems = dto.items !== undefined;
    const lines = replacingItems ? await this.buildLines(dto.items!) : existing.items;

    const making = {
      labourCost: new Prisma.Decimal(dto.labourCost ?? existing.labourCost),
      packagingCost: new Prisma.Decimal(dto.packagingCost ?? existing.packagingCost),
      overheadCost: new Prisma.Decimal(dto.overheadCost ?? existing.overheadCost),
      otherCost: new Prisma.Decimal(dto.otherCost ?? existing.otherCost),
    };
    const yieldQty = dto.batchYieldQuantity ?? existing.batchYieldQuantity;
    const totals = sheetTotals(lines, making, yieldQty);

    await this.prisma.$transaction(async (tx) => {
      if (replacingItems) {
        await tx.productCostSheetItem.deleteMany({ where: { costSheetId: id } });
      }

      await tx.productCostSheet.update({
        where: { id },
        data: {
          batchYieldQuantity: yieldQty,
          ...making,
          materialCost: totals.materialCost,
          totalBatchCost: totals.totalBatchCost,
          costPerUnit: totals.costPerUnit,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : existing.effectiveFrom,
          notes: dto.notes === undefined ? existing.notes : dto.notes,
          ...(replacingItems ? { items: { create: lines } } : {}),
        },
      });
    });

    return this.findOne(id);
  }

  /**
   * Deletes a version. If it was the active one, the newest remaining version is
   * reactivated - leaving a product with cost sheets but none active would
   * silently stop cost being captured at checkout.
   */
  async remove(id: string) {
    const sheet = await this.prisma.productCostSheet.findUnique({
      where: { id },
      select: { id: true, productId: true, isActive: true },
    });
    if (!sheet) throw new NotFoundException('Cost sheet not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.productCostSheet.delete({ where: { id } });

      if (sheet.isActive) {
        const fallback = await tx.productCostSheet.findFirst({
          where: { productId: sheet.productId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        if (fallback) {
          await tx.productCostSheet.update({
            where: { id: fallback.id },
            data: { isActive: true },
          });
        }
      }
    });

    return { message: 'Cost sheet deleted' };
  }

  /**
   * Price versus cost for every product with an active cost sheet.
   *
   * Products without one are reported separately rather than omitted: "we don't
   * know the margin" is itself information, and dropping them would make the
   * catalogue look fully costed when it isn't.
   */
  async margins() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        isActive: true,
        costSheets: {
          where: { isActive: true },
          select: { id: true, version: true, costPerUnit: true, effectiveFrom: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    const costed: CostedProduct[] = [];
    const uncosted: UncostedProduct[] = [];

    for (const product of products) {
      const sheet = product.costSheets[0];

      if (!sheet) {
        uncosted.push({
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
        });
        continue;
      }

      costed.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        isActive: product.isActive,
        costSheetId: sheet.id,
        costSheetVersion: sheet.version,
        ...computeMargin(product.price, sheet.costPerUnit),
      });
    }

    const lossMaking = costed.filter((c) => c.marginAmount.lt(0));

    return {
      costed,
      uncosted,
      summary: {
        productCount: products.length,
        costedCount: costed.length,
        uncostedCount: uncosted.length,
        lossMakingCount: lossMaking.length,
      },
    };
  }

  // ---------- internals ----------

  /**
   * Rates default to the material's current average cost, then are FROZEN onto
   * the sheet. Read live instead and every historical margin would move each
   * time a purchase shifted a material's average.
   */
  private async buildLines(items: CostSheetItemDto[]) {
    if (!items.length) {
      throw new BadRequestException('A cost sheet needs at least one material line');
    }

    const ids = [...new Set(items.map((i) => i.rawMaterialId))];
    const materials = await this.prisma.rawMaterial.findMany({
      where: { id: { in: ids } },
      select: { id: true, avgCostPerUnit: true },
    });

    if (materials.length !== ids.length) {
      throw new NotFoundException('One or more raw materials no longer exist');
    }

    const byId = new Map(materials.map((m) => [m.id, m]));

    return items.map((item) => {
      const material = byId.get(item.rawMaterialId)!;
      const rate =
        item.ratePerUnit !== undefined
          ? new Prisma.Decimal(item.ratePerUnit)
          : (material.avgCostPerUnit ?? ZERO);

      const quantity = new Prisma.Decimal(item.quantity);

      return {
        rawMaterialId: item.rawMaterialId,
        quantity,
        ratePerUnit: rate,
        lineCost: lineCost(quantity, rate),
        notes: item.notes,
      };
    });
  }

  private makingCosts(dto: CreateCostSheetDto | UpdateCostSheetDto) {
    return {
      labourCost: new Prisma.Decimal(dto.labourCost ?? 0),
      packagingCost: new Prisma.Decimal(dto.packagingCost ?? 0),
      overheadCost: new Prisma.Decimal(dto.overheadCost ?? 0),
      otherCost: new Prisma.Decimal(dto.otherCost ?? 0),
    };
  }

  private async assertProductExists(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
  }
}
