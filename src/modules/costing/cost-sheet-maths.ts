import { Prisma } from '@prisma/client';

/**
 * Cost-sheet arithmetic, kept pure so the rules can be tested without a
 * database and read without tracing through Prisma calls.
 */

export interface CostLine {
  quantity: Prisma.Decimal;
  ratePerUnit: Prisma.Decimal;
}

export interface MakingCosts {
  labourCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
  overheadCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
}

/** One line's contribution, rounded the way money is stored. */
export function lineCost(quantity: Prisma.Decimal, ratePerUnit: Prisma.Decimal): Prisma.Decimal {
  return quantity.mul(ratePerUnit).toDecimalPlaces(2);
}

export function materialCost(lines: { lineCost: Prisma.Decimal }[]): Prisma.Decimal {
  return lines.reduce((acc, l) => acc.add(l.lineCost), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

export interface SheetTotals {
  materialCost: Prisma.Decimal;
  totalBatchCost: Prisma.Decimal;
  costPerUnit: Prisma.Decimal;
}

/**
 * Batch total and per-unit cost.
 *
 * `batchYieldQuantity` must be at least 1 - dividing by zero is the one input
 * that turns this whole module into nonsense, so it is rejected at the DTO
 * layer rather than guarded against here.
 */
export function sheetTotals(
  lines: { lineCost: Prisma.Decimal }[],
  making: MakingCosts,
  batchYieldQuantity: number,
): SheetTotals {
  const materials = materialCost(lines);

  const totalBatchCost = materials
    .add(making.labourCost)
    .add(making.packagingCost)
    .add(making.overheadCost)
    .add(making.otherCost)
    .toDecimalPlaces(2);

  // 4dp: a per-unit cost on a large batch is genuinely fractional, and rounding
  // it to paisa here would distort every margin computed from it.
  const costPerUnit = totalBatchCost.div(batchYieldQuantity).toDecimalPlaces(4);

  return { materialCost: materials, totalBatchCost, costPerUnit };
}

export interface Margin {
  sellingPrice: Prisma.Decimal;
  costPerUnit: Prisma.Decimal;
  marginAmount: Prisma.Decimal;
  /** Percentage of the selling price, not a markup on cost. */
  marginPercent: Prisma.Decimal | null;
}

/**
 * Margin against a selling price.
 *
 * Expressed as a percentage of the SELLING price (gross margin), not a markup
 * on cost - the two differ enough to matter and mixing them is a classic way to
 * think a product is more profitable than it is.
 *
 * `marginPercent` is null when the price is zero: the ratio is undefined, and
 * reporting 0% would read as break-even rather than "not for sale".
 */
export function computeMargin(sellingPrice: Prisma.Decimal, costPerUnit: Prisma.Decimal): Margin {
  const marginAmount = sellingPrice.sub(costPerUnit).toDecimalPlaces(4);

  const marginPercent = sellingPrice.isZero()
    ? null
    : marginAmount.div(sellingPrice).mul(100).toDecimalPlaces(2);

  return { sellingPrice, costPerUnit, marginAmount, marginPercent };
}
