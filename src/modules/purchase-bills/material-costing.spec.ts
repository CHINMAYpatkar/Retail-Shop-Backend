import { Prisma } from '@prisma/client';
import {
  weightedAverageCost,
  lineTotal,
  billTotals,
  derivePaymentStatus,
} from './material-costing';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('weightedAverageCost', () => {
  it('returns null for no purchase history so a hand-entered opening cost survives', () => {
    // Returning 0 here would silently blank the cost a user typed in by hand.
    expect(weightedAverageCost([])).toBeNull();
  });

  it('weights by quantity, not by number of lines', () => {
    // 1kg at 100 + 9kg at 200 = 1900/10 = 190. A plain mean would say 150,
    // which is the bug this function exists to prevent.
    const avg = weightedAverageCost([
      { quantity: d(1), unitPrice: d(100) },
      { quantity: d(9), unitPrice: d(200) },
    ]);
    expect(avg!.toString()).toBe('190');
  });

  it('is order-independent', () => {
    const a = weightedAverageCost([
      { quantity: d('2.5'), unitPrice: d('120.50') },
      { quantity: d('7.25'), unitPrice: d('98.75') },
    ]);
    const b = weightedAverageCost([
      { quantity: d('7.25'), unitPrice: d('98.75') },
      { quantity: d('2.5'), unitPrice: d('120.50') },
    ]);
    expect(a!.toString()).toBe(b!.toString());
  });

  it('recomputing from full history equals the average of that history', () => {
    // The property that justifies recompute-from-history over reverse-subtract:
    // dropping a line and recomputing gives exactly the average of what remains,
    // with no drift. A moving average reversed in place cannot promise this.
    const all = [
      { quantity: d(10), unitPrice: d(50) },
      { quantity: d(5), unitPrice: d(80) },
      { quantity: d(3), unitPrice: d(65) },
    ];
    const withoutLast = weightedAverageCost(all.slice(0, 2));
    // (10*50 + 5*80) / 15 = 900/15 = 60
    expect(withoutLast!.toString()).toBe('60');
  });

  it('falls back to the mean of unit prices when every quantity is zero', () => {
    // Zero-quantity lines are legal (a correction, a free sample) but make a
    // quantity-weighted average undefined rather than zero.
    const avg = weightedAverageCost([
      { quantity: d(0), unitPrice: d(100) },
      { quantity: d(0), unitPrice: d(200) },
    ]);
    expect(avg!.toString()).toBe('150');
  });

  it('does not divide by zero when quantities cancel out', () => {
    const avg = weightedAverageCost([
      { quantity: d(5), unitPrice: d(100) },
      { quantity: d(-5), unitPrice: d(100) },
    ]);
    expect(avg).not.toBeNull();
    expect(avg!.isFinite()).toBe(true);
  });

  it('rounds to 4dp, the stored precision for a per-unit cost', () => {
    // 100/3 must not arrive as a float artefact.
    const avg = weightedAverageCost([{ quantity: d(3), unitPrice: d('33.333333') }]);
    expect(avg!.decimalPlaces()).toBeLessThanOrEqual(4);
  });
});

describe('lineTotal', () => {
  it('rounds to paisa', () => {
    expect(lineTotal(d('1.005'), d('10')).toString()).toBe('10.05');
  });

  it('keeps precision that float arithmetic would lose', () => {
    // 0.1 * 3 is 0.30000000000000004 in IEEE754. Decimal must say 0.3.
    expect(lineTotal(d('0.1'), d('3')).toString()).toBe('0.3');
  });
});

describe('billTotals', () => {
  it('derives the subtotal from the lines rather than trusting a supplied figure', () => {
    const { subtotal, totalAmount } = billTotals(
      [{ lineTotal: d('100.50') }, { lineTotal: d('249.50') }],
      d(0),
      d(0),
    );
    expect(subtotal.toString()).toBe('350');
    expect(totalAmount.toString()).toBe('350');
  });

  it('adds tax and subtracts discount in that order', () => {
    const { totalAmount } = billTotals([{ lineTotal: d('1000') }], d('50'), d('120'));
    expect(totalAmount.toString()).toBe('930');
  });

  it('totals an empty bill to zero rather than throwing', () => {
    const { subtotal, totalAmount } = billTotals([], d(0), d(0));
    expect(subtotal.toString()).toBe('0');
    expect(totalAmount.toString()).toBe('0');
  });

  it('allows a discount to exceed the subtotal (a credit note) without clamping', () => {
    // Clamping to zero here would hide a data-entry error instead of surfacing it.
    const { totalAmount } = billTotals([{ lineTotal: d('100') }], d(0), d('150'));
    expect(totalAmount.toString()).toBe('-50');
  });
});

describe('derivePaymentStatus', () => {
  it('is UNPAID at zero', () => {
    expect(derivePaymentStatus(d(1000), d(0))).toBe('UNPAID');
  });

  it('is PARTIALLY_PAID below the total', () => {
    expect(derivePaymentStatus(d(1000), d('999.99'))).toBe('PARTIALLY_PAID');
  });

  it('is PAID exactly at the total', () => {
    expect(derivePaymentStatus(d(1000), d(1000))).toBe('PAID');
  });

  it('treats an overpayment as PAID, not PARTIALLY_PAID', () => {
    expect(derivePaymentStatus(d(1000), d(1200))).toBe('PAID');
  });

  it('is UNPAID for a negative paid amount', () => {
    expect(derivePaymentStatus(d(1000), d(-50))).toBe('UNPAID');
  });

  it('reports a zero-total bill as PAID once anything is paid', () => {
    expect(derivePaymentStatus(d(0), d(1))).toBe('PAID');
  });

  it('reports a zero-total, zero-paid bill as UNPAID', () => {
    // Debatable either way; pinned so the behaviour cannot drift unnoticed.
    expect(derivePaymentStatus(d(0), d(0))).toBe('UNPAID');
  });
});
