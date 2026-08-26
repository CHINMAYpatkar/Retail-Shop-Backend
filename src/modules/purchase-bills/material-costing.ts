import { Prisma } from '@prisma/client';

/**
 * Stock and cost arithmetic for raw materials, kept as pure functions so the
 * rules can be reasoned about (and tested) without a database.
 *
 * Two different strategies, deliberately:
 *
 *  - **Stock is delta-based.** Purchases add, edits reverse-then-reapply,
 *    deletes subtract. Stock has sources other than bills (manual adjustment,
 *    and production batches later), so it cannot be derived from purchase
 *    history alone.
 *
 *  - **Average cost is recomputed from history**, never reverse-subtracted.
 *    A moving average is not exactly invertible: removing one purchase's
 *    contribution requires knowing the state before it, which later purchases
 *    have already overwritten. Subtracting would drift a little on every bill
 *    edit, and nothing would ever notice - there is no customer to complain
 *    that a cost figure is 2% wrong. Recomputing is order-independent and
 *    always exactly right, and bill entry is nowhere near a hot path.
 */

export interface PurchaseLine {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
}

/**
 * Weighted average of everything actually paid for a material.
 *
 * Returns null when there are no purchase lines at all - the caller then leaves
 * whatever opening cost was entered by hand, rather than blanking it.
 */
export function weightedAverageCost(lines: PurchaseLine[]): Prisma.Decimal | null {
  if (lines.length === 0) return null;

  let totalQuantity = new Prisma.Decimal(0);
  let totalCost = new Prisma.Decimal(0);

  for (const line of lines) {
    totalQuantity = totalQuantity.add(line.quantity);
    totalCost = totalCost.add(line.quantity.mul(line.unitPrice));
  }

  // Zero-quantity lines are legal (a correction, or a free sample) but make the
  // average undefined. Fall back to the plain mean of the unit prices, which is
  // the only sensible reading when no quantity is involved.
  if (totalQuantity.isZero()) {
    const sum = lines.reduce((acc, l) => acc.add(l.unitPrice), new Prisma.Decimal(0));
    return sum.div(lines.length).toDecimalPlaces(4);
  }

  return totalCost.div(totalQuantity).toDecimalPlaces(4);
}

/** Line total, rounded the way money is stored. */
export function lineTotal(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal): Prisma.Decimal {
  return quantity.mul(unitPrice).toDecimalPlaces(2);
}

/**
 * Bill totals, always computed here rather than taken from the client.
 *
 * A client-supplied total is how you get a bill whose figure disagrees with the
 * sum of its own lines - and then every report built on it is quietly wrong.
 */
export function billTotals(
  lines: { lineTotal: Prisma.Decimal }[],
  taxAmount: Prisma.Decimal,
  discountAmount: Prisma.Decimal,
): { subtotal: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  const subtotal = lines
    .reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0))
    .toDecimalPlaces(2);

  const totalAmount = subtotal.add(taxAmount).sub(discountAmount).toDecimalPlaces(2);
  return { subtotal, totalAmount };
}

export type BillPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

/**
 * Derives payment status from what has actually been paid.
 *
 * Never stored: a stored status is wrong the moment a payment is edited or
 * deleted, and nothing would flag it.
 */
export function derivePaymentStatus(
  totalAmount: Prisma.Decimal,
  paidAmount: Prisma.Decimal,
): BillPaymentStatus {
  if (paidAmount.lte(0)) return 'UNPAID';
  // gte, not eq: an overpayment still counts as paid rather than falling back
  // to "partially", which would be the more confusing of the two answers.
  if (paidAmount.gte(totalAmount)) return 'PAID';
  return 'PARTIALLY_PAID';
}
