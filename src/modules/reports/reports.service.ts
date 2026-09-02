import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DateRangeDto } from './dto/date-range.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * Read-only aggregation over what the other modules record. No new state.
 *
 * Two conventions run through all of it:
 *
 *  - **Revenue means DELIVERED orders only.** Payment is collected on delivery,
 *    so an order that has not arrived is not money the business holds.
 *  - **Only COMPLETED refunds are deducted.** A PENDING refund is a liability,
 *    not money that has left - it is reported separately rather than folded in.
 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private range(dto: DateRangeDto) {
    if (!dto.fromDate && !dto.toDate) return undefined;
    return {
      ...(dto.fromDate ? { gte: new Date(dto.fromDate) } : {}),
      ...(dto.toDate ? { lte: new Date(dto.toDate) } : {}),
    };
  }

  /**
   * Profit and loss.
   *
   * Reports COGS **coverage** alongside the figure, because cost data is
   * optional: an order item placed before its product had a cost sheet carries
   * a null `unitCostPrice`. Without the coverage number an incomplete COGS
   * silently overstates profit, which is the single most misleading thing this
   * report could do.
   */
  async profitAndLoss(dto: DateRangeDto) {
    const createdAt = this.range(dto);

    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.DELIVERED,
        ...(createdAt ? { createdAt } : {}),
      },
      select: {
        id: true,
        totalAmount: true,
        items: { select: { quantity: true, unitPrice: true, unitCostPrice: true } },
      },
    });

    let revenue = ZERO;
    let cogs = ZERO;
    let itemsWithCost = 0;
    let itemsTotal = 0;

    for (const order of orders) {
      revenue = revenue.add(order.totalAmount);

      for (const item of order.items) {
        itemsTotal += 1;
        if (item.unitCostPrice !== null) {
          itemsWithCost += 1;
          cogs = cogs.add(item.unitCostPrice.mul(item.quantity));
        }
      }
    }

    revenue = revenue.toDecimalPlaces(2);
    cogs = cogs.toDecimalPlaces(2);

    const [refundsCompleted, refundsPending, expenseAgg, expensesByCategory] =
      await this.prisma.$transaction([
        // Scoped to the SAME orders that produced `revenue` above - delivered,
        // and placed inside the period - not to when the refund was recorded.
        //
        // Filtering by `refund.createdAt` instead looks equivalent and is not:
        // a refund entered today against a 60-day-old order would be netted off
        // this period's revenue, which that order never contributed to. In a
        // slow month that reports negative revenue for a shop that traded
        // profitably. Cash actually refunded in a period is a different
        // question, answered by the refunds list rather than by the P&L.
        this.prisma.refund.aggregate({
          where: {
            status: RefundStatus.COMPLETED,
            order: { status: OrderStatus.DELIVERED, ...(createdAt ? { createdAt } : {}) },
          },
          _sum: { amount: true },
        }),
        // Point-in-time, deliberately NOT scoped to the period: money owed but
        // not yet sent is a balance, not a flow, and the dashboard reports the
        // same figure the same way. Two screens disagreeing on this once cost a
        // day of debugging.
        this.prisma.refund.aggregate({
          where: { status: RefundStatus.PENDING },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: createdAt ? { spentOn: createdAt } : {},
          _sum: { amount: true },
        }),
        this.prisma.expense.groupBy({
          by: ['category'],
          where: createdAt ? { spentOn: createdAt } : {},
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
      ]);

    const refunds = (refundsCompleted._sum.amount ?? ZERO).toDecimalPlaces(2);
    const pendingRefunds = (refundsPending._sum.amount ?? ZERO).toDecimalPlaces(2);
    const expenses = (expenseAgg._sum.amount ?? ZERO).toDecimalPlaces(2);

    const netRevenue = revenue.sub(refunds).toDecimalPlaces(2);
    const grossProfit = netRevenue.sub(cogs).toDecimalPlaces(2);
    const netProfit = grossProfit.sub(expenses).toDecimalPlaces(2);

    const grossMarginPercent = netRevenue.isZero()
      ? null
      : grossProfit.div(netRevenue).mul(100).toDecimalPlaces(2);
    const netMarginPercent = netRevenue.isZero()
      ? null
      : netProfit.div(netRevenue).mul(100).toDecimalPlaces(2);

    return {
      period: { fromDate: dto.fromDate ?? null, toDate: dto.toDate ?? null },
      revenue: {
        grossRevenue: revenue,
        refunds,
        netRevenue,
        orderCount: orders.length,
      },
      cost: {
        cogs,
        // Read this before trusting grossProfit.
        coverage: {
          itemsWithCost,
          itemsTotal,
          percent:
            itemsTotal === 0
              ? null
              : new Prisma.Decimal(itemsWithCost).div(itemsTotal).mul(100).toDecimalPlaces(1),
          complete: itemsTotal > 0 && itemsWithCost === itemsTotal,
        },
      },
      expenses: {
        total: expenses,
        byCategory: expensesByCategory.map((row) => ({
          category: row.category,
          amount: row._sum?.amount ?? ZERO,
        })),
      },
      profit: { grossProfit, netProfit, grossMarginPercent, netMarginPercent },
      /** Not deducted anywhere above - money owed but not yet sent. */
      liabilities: { pendingRefunds },
    };
  }

  /**
   * What is owed to each vendor, with simple aging.
   *
   * Buckets are measured against the due date, falling back to the bill date
   * when none was recorded - "overdue" needs a reference point, and treating a
   * due-date-less bill as never-due would hide genuinely old debt.
   */
  async vendorPayables() {
    const vendors = await this.prisma.vendor.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        bills: {
          select: {
            id: true,
            billDate: true,
            dueDate: true,
            totalAmount: true,
            payments: { select: { amount: true } },
          },
        },
        payments: { where: { purchaseBillId: null }, select: { amount: true } },
      },
      orderBy: { name: 'asc' },
    });

    const today = new Date();
    const daysSince = (from: Date) =>
      Math.floor((today.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

    const rows = vendors.map((vendor) => {
      let billed = ZERO;
      let paid = ZERO;
      const aging = { current: ZERO, upTo30: ZERO, upTo60: ZERO, over60: ZERO };
      let oldestUnpaidBillDate: Date | null = null;
      let unpaidBillCount = 0;

      for (const bill of vendor.bills) {
        const billPaid = bill.payments.reduce((acc, p) => acc.add(p.amount), ZERO);
        billed = billed.add(bill.totalAmount);
        paid = paid.add(billPaid);

        const outstanding = bill.totalAmount.sub(billPaid);
        if (outstanding.lte(0)) continue;

        unpaidBillCount += 1;
        if (!oldestUnpaidBillDate || bill.billDate < oldestUnpaidBillDate) {
          oldestUnpaidBillDate = bill.billDate;
        }

        const overdueDays = daysSince(bill.dueDate ?? bill.billDate);
        if (overdueDays <= 0) aging.current = aging.current.add(outstanding);
        else if (overdueDays <= 30) aging.upTo30 = aging.upTo30.add(outstanding);
        else if (overdueDays <= 60) aging.upTo60 = aging.upTo60.add(outstanding);
        else aging.over60 = aging.over60.add(outstanding);
      }

      // Already counted inside `paid`; surfaced separately only to explain a
      // negative balance (the vendor holding an advance).
      const onAccount = vendor.payments.reduce((acc, p) => acc.add(p.amount), ZERO);

      return {
        id: vendor.id,
        name: vendor.name,
        isActive: vendor.isActive,
        billed: billed.toDecimalPlaces(2),
        paid: paid.toDecimalPlaces(2),
        outstanding: billed.sub(paid).toDecimalPlaces(2),
        onAccount: onAccount.toDecimalPlaces(2),
        unpaidBillCount,
        oldestUnpaidBillDate,
        oldestUnpaidDays: oldestUnpaidBillDate ? daysSince(oldestUnpaidBillDate) : null,
        aging,
      };
    });

    const owing = rows.filter((r) => r.outstanding.gt(0));

    return {
      vendors: rows,
      summary: {
        vendorCount: rows.length,
        vendorsOwedCount: owing.length,
        totalOutstanding: rows.reduce((acc, r) => acc.add(r.outstanding), ZERO).toDecimalPlaces(2),
        overdueOver60: owing.reduce((acc, r) => acc.add(r.aging.over60), ZERO).toDecimalPlaces(2),
      },
    };
  }

  /**
   * What the raw-material stock on hand is worth, at each material's average cost.
   *
   * Materials with no cost recorded are counted separately rather than valued at
   * zero: zero would quietly understate the total while looking like a real
   * figure.
   */
  async stockValuation() {
    const materials = await this.prisma.rawMaterial.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        baseUnit: true,
        stockQuantity: true,
        reorderLevel: true,
        avgCostPerUnit: true,
      },
      orderBy: { name: 'asc' },
    });

    let totalValue = ZERO;
    let unvaluedCount = 0;
    let lowStockCount = 0;

    const rows = materials.map((material) => {
      const cost = material.avgCostPerUnit;
      if (cost === null) unvaluedCount += 1;

      const stockValue = cost === null ? null : material.stockQuantity.mul(cost).toDecimalPlaces(2);
      if (stockValue) totalValue = totalValue.add(stockValue);

      const isLowStock =
        material.reorderLevel !== null && material.stockQuantity.lte(material.reorderLevel);
      if (isLowStock) lowStockCount += 1;

      return { ...material, stockValue, isLowStock };
    });

    return {
      materials: rows,
      summary: {
        materialCount: rows.length,
        totalValue: totalValue.toDecimalPlaces(2),
        unvaluedCount,
        lowStockCount,
      },
    };
  }

  /** Purchase spend broken down by vendor and by material over a period. */
  async purchaseSummary(dto: DateRangeDto) {
    const billDate = this.range(dto);

    const bills = await this.prisma.purchaseBill.findMany({
      where: billDate ? { billDate } : {},
      select: {
        totalAmount: true,
        vendor: { select: { id: true, name: true } },
        items: {
          select: {
            quantity: true,
            lineTotal: true,
            rawMaterial: { select: { id: true, name: true, baseUnit: true } },
          },
        },
      },
    });

    const byVendor = new Map<string, { name: string; amount: Prisma.Decimal; billCount: number }>();
    const byMaterial = new Map<
      string,
      { name: string; baseUnit: string; quantity: Prisma.Decimal; amount: Prisma.Decimal }
    >();
    let totalSpend = ZERO;

    for (const bill of bills) {
      totalSpend = totalSpend.add(bill.totalAmount);

      const vendor = byVendor.get(bill.vendor.id) ?? {
        name: bill.vendor.name,
        amount: ZERO,
        billCount: 0,
      };
      vendor.amount = vendor.amount.add(bill.totalAmount);
      vendor.billCount += 1;
      byVendor.set(bill.vendor.id, vendor);

      for (const item of bill.items) {
        const existing = byMaterial.get(item.rawMaterial.id) ?? {
          name: item.rawMaterial.name,
          baseUnit: item.rawMaterial.baseUnit as string,
          quantity: ZERO,
          amount: ZERO,
        };
        existing.quantity = existing.quantity.add(item.quantity);
        existing.amount = existing.amount.add(item.lineTotal);
        byMaterial.set(item.rawMaterial.id, existing);
      }
    }

    return {
      period: { fromDate: dto.fromDate ?? null, toDate: dto.toDate ?? null },
      summary: { totalSpend: totalSpend.toDecimalPlaces(2), billCount: bills.length },
      byVendor: [...byVendor.entries()]
        .map(([id, v]) => ({
          id,
          name: v.name,
          amount: v.amount.toDecimalPlaces(2),
          billCount: v.billCount,
        }))
        .sort((a, b) => b.amount.comparedTo(a.amount)),
      byMaterial: [...byMaterial.entries()]
        .map(([id, m]) => ({
          id,
          name: m.name,
          baseUnit: m.baseUnit,
          quantity: m.quantity.toDecimalPlaces(3),
          amount: m.amount.toDecimalPlaces(2),
        }))
        .sort((a, b) => b.amount.comparedTo(a.amount)),
    };
  }
}
