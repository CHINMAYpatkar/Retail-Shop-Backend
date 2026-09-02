import { Prisma } from '@prisma/client';
import { lineCost, materialCost, sheetTotals, computeMargin } from './cost-sheet-maths';

const d = (v: string | number) => new Prisma.Decimal(v);

const noMaking = {
  labourCost: d(0),
  packagingCost: d(0),
  overheadCost: d(0),
  otherCost: d(0),
};

describe('lineCost / materialCost', () => {
  it('rounds a line to paisa', () => {
    expect(lineCost(d('2.5'), d('99.99')).toString()).toBe('249.98');
  });

  it('sums lines without float drift', () => {
    // Three lots of 0.1 must be 0.3, not 0.30000000000000004.
    const total = materialCost([
      { lineCost: d('0.1') },
      { lineCost: d('0.1') },
      { lineCost: d('0.1') },
    ]);
    expect(total.toString()).toBe('0.3');
  });

  it('totals no lines to zero', () => {
    expect(materialCost([]).toString()).toBe('0');
  });
});

describe('sheetTotals', () => {
  it('adds every making cost to the material cost', () => {
    const { materialCost: mat, totalBatchCost } = sheetTotals(
      [{ lineCost: d('500') }],
      { labourCost: d('100'), packagingCost: d('50'), overheadCost: d('30'), otherCost: d('20') },
      10,
    );
    expect(mat.toString()).toBe('500');
    expect(totalBatchCost.toString()).toBe('700');
  });

  it('divides by batch yield to get a per-unit cost', () => {
    const { costPerUnit } = sheetTotals([{ lineCost: d('700') }], noMaking, 10);
    expect(costPerUnit.toString()).toBe('70');
  });

  it('keeps 4dp on a per-unit cost that does not divide evenly', () => {
    // 100/3 = 33.3333. Rounding to paisa here would distort every margin built
    // on it, which is why per-unit cost is stored at 4dp and money at 2dp.
    const { costPerUnit } = sheetTotals([{ lineCost: d('100') }], noMaking, 3);
    expect(costPerUnit.toString()).toBe('33.3333');
  });

  it('omits no making cost from the batch total', () => {
    // Guards against a refactor that adds a field to MakingCosts and forgets to
    // include it in the sum - the failure mode would be a quietly optimistic cost.
    const each = sheetTotals(
      [],
      { labourCost: d(1), packagingCost: d(2), overheadCost: d(4), otherCost: d(8) },
      1,
    );
    expect(each.totalBatchCost.toString()).toBe('15');
  });

  it('handles a batch of one', () => {
    const { costPerUnit } = sheetTotals([{ lineCost: d('42.75') }], noMaking, 1);
    expect(costPerUnit.toString()).toBe('42.75');
  });
});

describe('computeMargin', () => {
  it('reports margin as a share of the selling price, not a markup on cost', () => {
    // Cost 60, price 100. Gross margin is 40% of price.
    // A markup-on-cost reading would be 66.67% - the classic way to believe a
    // product is far more profitable than it is.
    const m = computeMargin(d(100), d(60));
    expect(m.marginAmount.toString()).toBe('40');
    expect(m.marginPercent!.toString()).toBe('40');
  });

  it('goes negative when cost exceeds price', () => {
    const m = computeMargin(d(50), d(80));
    expect(m.marginAmount.toString()).toBe('-30');
    expect(m.marginPercent!.toString()).toBe('-60');
  });

  it('returns null percent at a zero price rather than 0%', () => {
    // 0% would read as break-even; null reads as "not for sale", which is the truth.
    const m = computeMargin(d(0), d(25));
    expect(m.marginPercent).toBeNull();
    expect(m.marginAmount.toString()).toBe('-25');
  });

  it('is 100% when cost is zero', () => {
    const m = computeMargin(d(100), d(0));
    expect(m.marginPercent!.toString()).toBe('100');
  });

  it('rounds percent to 2dp', () => {
    const m = computeMargin(d(3), d(1));
    expect(m.marginPercent!.toString()).toBe('66.67');
  });

  it('echoes its inputs back unchanged for display', () => {
    const m = computeMargin(d('249.50'), d('99.1234'));
    expect(m.sellingPrice.toString()).toBe('249.5');
    expect(m.costPerUnit.toString()).toBe('99.1234');
  });
});
