/**
 * Revenue reporting, and specifically whether revenue and the refunds netted
 * off it are measured on the same basis.
 *
 * Revenue is scoped by when the ORDER was placed and counts only DELIVERED
 * orders, because payment is collected on delivery. If refunds are scoped by
 * when the REFUND was recorded instead, the two sides describe different sets
 * of orders, and a refund against an old order silently reduces this period's
 * revenue. In a slow month that can drive reported revenue negative while the
 * shop was in fact profitable - a number a business decision might rest on.
 */
import { AdminRoleName, OrderStatus, PaymentStatus, RefundStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';
import { createOrder, cleanupOrders, resetFinancialData } from './helpers/orders';

const DAY = 24 * 60 * 60 * 1000;

describe('Reports and dashboard revenue (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', AdminRoleName.ADMIN, '-reports'));
    await resetFinancialData(ctx.prisma);
  });

  afterAll(async () => {
    await resetFinancialData(ctx.prisma);
    await cleanupOrders(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  /** Backdates an order so it falls outside a recent window. */
  async function backdate(orderId: string, daysAgo: number) {
    await ctx.prisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - daysAgo * DAY) },
    });
  }

  async function completedRefund(orderId: string, amount: string) {
    return ctx.prisma.refund.create({
      data: {
        orderId,
        amount: new Prisma.Decimal(amount),
        reason: 'e2e',
        method: 'BANK_TRANSFER',
        status: RefundStatus.COMPLETED,
        refundedOn: new Date(),
      },
    });
  }

  const pnl = () =>
    request(http).get(ctx.url('admin/reports/profit-loss')).set('Authorization', `Bearer ${token}`);

  const dashboard = () =>
    request(http).get(ctx.url('admin/dashboard/summary')).set('Authorization', `Bearer ${token}`);

  const since30d = () => new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);

  it('counts a delivered order as revenue', async () => {
    await resetFinancialData(ctx.prisma);
    await createOrder(ctx.prisma, { total: '1000.00' });

    const res = await pnl();
    expect(res.status).toBe(200);
    expect(Number(res.body.data.revenue.grossRevenue)).toBe(1000);
  });

  it('does not count a cancelled or in-flight order as revenue', async () => {
    await resetFinancialData(ctx.prisma);
    await createOrder(ctx.prisma, { total: '777.00', status: OrderStatus.CANCELLED });
    await createOrder(ctx.prisma, { total: '888.00', status: OrderStatus.SHIPPED });

    expect(Number((await pnl()).body.data.revenue.grossRevenue)).toBe(0);
  });

  it('nets a completed refund off the revenue of the order it belongs to', async () => {
    await resetFinancialData(ctx.prisma);
    const order = await createOrder(ctx.prisma, { total: '1000.00' });
    await completedRefund(order.orderId, '250.00');

    const body = (await pnl()).body.data;
    expect(Number(body.revenue.grossRevenue)).toBe(1000);
    expect(Number(body.revenue.refunds)).toBe(250);
    expect(Number(body.revenue.netRevenue)).toBe(750);
  });

  it('does not let a refund on an out-of-period order reduce this period revenue', async () => {
    await resetFinancialData(ctx.prisma);

    // An old order, delivered then refunded in full, with the refund recorded now.
    const old = await createOrder(ctx.prisma, { total: '5000.00' });
    await backdate(old.orderId, 60);
    await completedRefund(old.orderId, '5000.00');

    // A modest but real sale inside the window.
    await createOrder(ctx.prisma, { total: '1000.00' });

    const res = await request(http)
      .get(ctx.url(`admin/reports/profit-loss?fromDate=${since30d()}`))
      .set('Authorization', `Bearer ${token}`);

    const body = res.body.data;
    expect(Number(body.revenue.grossRevenue)).toBe(1000);
    // Netting the 5000 here would report -4000 for a month that took 1000.
    expect(Number(body.revenue.refunds)).toBe(0);
    expect(Number(body.revenue.netRevenue)).toBe(1000);
  });

  it('does not let a refund on a cancelled order reduce delivered revenue', async () => {
    await resetFinancialData(ctx.prisma);
    await createOrder(ctx.prisma, { total: '1000.00' });

    const cancelled = await createOrder(ctx.prisma, {
      total: '400.00',
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.PENDING,
    });
    await completedRefund(cancelled.orderId, '400.00');

    const body = (await pnl()).body.data;
    // A cancelled order was never revenue, so its refund cannot reduce revenue.
    expect(Number(body.revenue.grossRevenue)).toBe(1000);
    expect(Number(body.revenue.netRevenue)).toBe(1000);
  });

  it('reports the dashboard and the P&L on the same basis', async () => {
    // These two screens disagreed once already, by a factor of 3.4. Whatever
    // the definition is, both have to use it.
    await resetFinancialData(ctx.prisma);
    await createOrder(ctx.prisma, { total: '1200.00' });
    const other = await createOrder(ctx.prisma, { total: '800.00' });
    await completedRefund(other.orderId, '300.00');

    const pnlBody = (
      await request(http)
        .get(ctx.url(`admin/reports/profit-loss?fromDate=${since30d()}`))
        .set('Authorization', `Bearer ${token}`)
    ).body.data;
    const dashBody = (await dashboard()).body.data;

    expect(Number(dashBody.grossRevenueLast30Days)).toBe(Number(pnlBody.revenue.grossRevenue));
    expect(Number(dashBody.refundsLast30Days)).toBe(Number(pnlBody.revenue.refunds));
  });

  it('reports pending refunds as a liability and never nets them off revenue', async () => {
    await resetFinancialData(ctx.prisma);
    const order = await createOrder(ctx.prisma, { total: '1000.00' });
    await ctx.prisma.refund.create({
      data: {
        orderId: order.orderId,
        amount: new Prisma.Decimal('600.00'),
        reason: 'e2e pending',
        method: 'BANK_TRANSFER',
        status: RefundStatus.PENDING,
      },
    });

    const body = (await pnl()).body.data;
    expect(Number(body.revenue.netRevenue)).toBe(1000);
    expect(Number(body.liabilities.pendingRefunds)).toBeGreaterThanOrEqual(600);
  });

  it('flags cost coverage so gross profit is not read as exact when it is not', async () => {
    await resetFinancialData(ctx.prisma);
    await createOrder(ctx.prisma, { total: '1000.00', unitCostPrice: '400.0000' });
    await createOrder(ctx.prisma, { total: '500.00', unitCostPrice: null });

    const body = (await pnl()).body.data;
    expect(body.cost.coverage.itemsTotal).toBe(2);
    expect(body.cost.coverage.itemsWithCost).toBe(1);
    expect(body.cost.coverage.complete).toBe(false);
    expect(Number(body.cost.cogs)).toBe(400);
  });
});
