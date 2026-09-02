/**
 * Manual refunds recorded against orders.
 *
 * There is no payment gateway: the shop takes cash on delivery and sends
 * refunds by hand. The admin records what happened so the ledger and the
 * reports stay true. That makes two invariants load-bearing:
 *
 *  1. Total refunds on an order can never exceed the order total, or every
 *     report downstream shows negative revenue.
 *  2. Only a COMPLETED refund moves the order's payment status - money merely
 *     agreed has not left the account.
 */
import { AdminRoleName, OrderStatus, PaymentStatus, RefundStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';
import { createOrder, cleanupOrders } from './helpers/orders';

describe('Refunds (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', AdminRoleName.ADMIN, '-refund'));
  });

  afterAll(async () => {
    await cleanupOrders(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  const post = (orderId: string, body: Record<string, unknown>) =>
    request(http)
      .post(ctx.url(`admin/orders/${orderId}/refunds`))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const patch = (refundId: string, body: Record<string, unknown>) =>
    request(http)
      .patch(ctx.url(`admin/refunds/${refundId}`))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const base = { reason: 'Damaged in transit', method: 'BANK_TRANSFER' };

  describe('which orders can be refunded', () => {
    it.each([OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.CANCELLED])(
      'allows a refund on a %s order',
      async (status) => {
        const order = await createOrder(ctx.prisma, { total: '500.00', status });
        const res = await post(order.orderId, { ...base, amount: 100 });
        expect(res.status).toBeLessThan(300);
      },
    );

    it.each([OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.PACKED, OrderStatus.SHIPPED])(
      'refuses a refund on a %s order, where no money has been collected yet',
      async (status) => {
        const order = await createOrder(ctx.prisma, { total: '500.00', status });
        const res = await post(order.orderId, { ...base, amount: 100 });
        expect(res.status).toBe(400);
      },
    );

    it('404s for an order that does not exist', async () => {
      const res = await post('00000000-0000-4000-8000-000000000999', { ...base, amount: 10 });
      expect(res.status).toBe(404);
    });
  });

  describe('the order total is a hard ceiling', () => {
    it('allows a refund up to exactly the order total', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const res = await post(order.orderId, { ...base, amount: 500 });
      expect(res.status).toBeLessThan(300);
    });

    it('refuses a single refund above the order total', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const res = await post(order.orderId, { ...base, amount: 500.01 });
      expect(res.status).toBe(400);
    });

    it('refuses partial refunds that together exceed the total', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      expect((await post(order.orderId, { ...base, amount: 300 })).status).toBeLessThan(300);
      expect((await post(order.orderId, { ...base, amount: 150 })).status).toBeLessThan(300);

      const over = await post(order.orderId, { ...base, amount: 51 });
      expect(over.status).toBe(400);

      const sum = await ctx.prisma.refund.aggregate({
        where: { orderId: order.orderId },
        _sum: { amount: true },
      });
      expect(Number(sum._sum.amount)).toBeLessThanOrEqual(500);
    });

    it('rejects a zero or negative refund', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      expect((await post(order.orderId, { ...base, amount: 0 })).status).toBe(400);
      expect((await post(order.orderId, { ...base, amount: -50 })).status).toBe(400);
    });

    it('refuses an edit that would push the total over', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const first = await post(order.orderId, { ...base, amount: 400 });
      const second = await post(order.orderId, { ...base, amount: 100 });

      const res = await patch(second.body.data.id, { amount: 200 });
      expect(res.status).toBe(400);
      expect(first.status).toBeLessThan(300);
    });

    it('allows re-saving a refund at its own unchanged amount', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const created = await post(order.orderId, { ...base, amount: 500 });
      const res = await patch(created.body.data.id, { amount: 500 });
      expect(res.status).toBeLessThan(300);
    });
  });

  describe('only a COMPLETED refund moves the order payment status', () => {
    it('leaves payment status alone for a PENDING refund', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      await post(order.orderId, { ...base, amount: 500, status: RefundStatus.PENDING });

      const after = await ctx.prisma.order.findUnique({ where: { id: order.orderId } });
      expect(after!.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('marks the order PARTIALLY_REFUNDED for a completed partial refund', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      await post(order.orderId, { ...base, amount: 200, status: RefundStatus.COMPLETED });

      const after = await ctx.prisma.order.findUnique({ where: { id: order.orderId } });
      expect(after!.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('marks the order REFUNDED for a completed full refund', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      await post(order.orderId, { ...base, amount: 500, status: RefundStatus.COMPLETED });

      const after = await ctx.prisma.order.findUnique({ where: { id: order.orderId } });
      expect(after!.paymentStatus).toBe(PaymentStatus.REFUNDED);
    });

    it('reverts the order to PAID when a completed refund is moved back to PENDING', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const created = await post(order.orderId, {
        ...base,
        amount: 500,
        status: RefundStatus.COMPLETED,
      });
      expect(
        (await ctx.prisma.order.findUnique({ where: { id: order.orderId } }))!.paymentStatus,
      ).toBe(PaymentStatus.REFUNDED);

      await patch(created.body.data.id, { status: RefundStatus.PENDING });

      const after = await ctx.prisma.order.findUnique({ where: { id: order.orderId } });
      expect(after!.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('stamps refundedOn when a refund becomes COMPLETED', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const created = await post(order.orderId, { ...base, amount: 100 });
      expect(created.body.data.refundedOn).toBeFalsy();

      const done = await patch(created.body.data.id, { status: RefundStatus.COMPLETED });
      expect(done.body.data.refundedOn).toBeTruthy();
    });
  });

  describe('a FAILED refund releases the money it never sent', () => {
    it('lets a failed refund be re-attempted for the full amount', async () => {
      // A bank transfer that bounced moved no money. The customer is still owed
      // the full amount, so recording the retry must be possible - and it must
      // not require editing the failed row, because the failed attempt is part
      // of the audit trail. This matters precisely because refunds have no
      // delete endpoint by design.
      const order = await createOrder(ctx.prisma, { total: '500.00' });

      const attempt = await post(order.orderId, {
        ...base,
        amount: 500,
        status: RefundStatus.COMPLETED,
      });
      expect(attempt.status).toBeLessThan(300);

      await patch(attempt.body.data.id, { status: RefundStatus.FAILED });

      const retry = await post(order.orderId, { ...base, amount: 500 });
      expect(retry.status).toBeLessThan(300);
    });

    it('does not let a failed refund inflate the refunded total', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const failed = await post(order.orderId, { ...base, amount: 500 });
      await patch(failed.body.data.id, { status: RefundStatus.FAILED });

      const retry = await post(order.orderId, { ...base, amount: 300 });
      expect(retry.status).toBeLessThan(300);

      const after = await ctx.prisma.order.findUnique({ where: { id: order.orderId } });
      expect(after!.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('still refuses a retry that exceeds the total once other refunds stand', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const failed = await post(order.orderId, { ...base, amount: 200 });
      await patch(failed.body.data.id, { status: RefundStatus.FAILED });

      expect((await post(order.orderId, { ...base, amount: 500 })).status).toBeLessThan(300);
      // The full 500 is now committed as PENDING, so nothing more is refundable.
      expect((await post(order.orderId, { ...base, amount: 1 })).status).toBe(400);
    });
  });

  describe('refunds are financial records', () => {
    it('exposes no delete endpoint', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const created = await post(order.orderId, { ...base, amount: 100 });

      const res = await request(http)
        .delete(ctx.url(`admin/refunds/${created.body.data.id}`))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      const still = await ctx.prisma.refund.findUnique({ where: { id: created.body.data.id } });
      expect(still).not.toBeNull();
    });

    it('records which admin processed the refund', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const created = await post(order.orderId, { ...base, amount: 100 });

      const row = await ctx.prisma.refund.findUnique({ where: { id: created.body.data.id } });
      expect(row!.processedByAdminId).toBeTruthy();
    });

    it('requires a reason', async () => {
      const order = await createOrder(ctx.prisma, { total: '500.00' });
      const res = await post(order.orderId, { amount: 100, method: 'BANK_TRANSFER' });
      expect(res.status).toBe(400);
    });
  });
});
