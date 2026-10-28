/**
 * Review gating.
 *
 * Built in August and **never exercisable until now** - it needed a delivered
 * order to test against, and the storefront could not place one until October.
 * This is the first automated coverage of a rule that has been live two months.
 *
 * The rule: a customer may review a product only if they have an order for it
 * that reached DELIVERED, and only once. It REJECTS rather than accepting and
 * hiding, so the storefront can say honestly why the form is unavailable
 * instead of swallowing a review that silently never appears.
 */
import { OrderStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { cleanupAdmins } from './helpers/fixtures';
import { cleanupCustomers, customerToken } from './helpers/customers';
import { createOrder, cleanupOrders, resetFinancialData } from './helpers/orders';

describe('Review gating (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const prefix = 'api/v1';

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    await resetFinancialData(ctx.prisma);
  });

  afterAll(async () => {
    await resetFinancialData(ctx.prisma);
    await cleanupOrders(ctx.prisma);
    await cleanupCustomers(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  const post = (token: string, body: Record<string, unknown>) =>
    request(http)
      .post(ctx.url('customer/reviews'))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /**
   * A signed-in customer holding an order for a fresh product, at the status
   * asked for. `createOrder` makes its own customer, so the order is pointed
   * back at ours - otherwise the purchase belongs to someone else and every
   * spec would pass for the wrong reason.
   */
  async function customerWithOrder(suffix: string, status: OrderStatus) {
    const { token, customer } = await customerToken(ctx.app, ctx.prisma, prefix, suffix);
    const order = await createOrder(ctx.prisma, { total: '320.00', status });

    await ctx.prisma.order.update({
      where: { id: order.orderId },
      data: { customerId: customer.id },
    });

    return { token, productId: order.productId };
  }

  it('accepts a review for a product on a DELIVERED order', async () => {
    const { token, productId } = await customerWithOrder('-rev-ok', OrderStatus.DELIVERED);

    const res = await post(token, { productId, rating: 5, comment: 'Smelled like a kitchen.' });

    expect(res.status).toBeLessThan(300);
    expect(res.body.data.rating).toBe(5);
  });

  it('marks it as a verified purchase', async () => {
    const { token, productId } = await customerWithOrder('-rev-verified', OrderStatus.DELIVERED);
    const res = await post(token, { productId, rating: 4 });

    const row = await ctx.prisma.review.findUnique({ where: { id: res.body.data.id } });
    expect(row?.isVerifiedPurchase).toBe(true);
  });

  it('holds it for approval rather than publishing it', async () => {
    const { token, productId } = await customerWithOrder('-rev-pending', OrderStatus.DELIVERED);
    const res = await post(token, { productId, rating: 5 });

    const row = await ctx.prisma.review.findUnique({ where: { id: res.body.data.id } });
    expect(row?.status).toBe('PENDING');
  });

  describe('refuses a review the customer has not earned', () => {
    it.each([
      OrderStatus.PLACED,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.CANCELLED,
    ])('refuses when the order is only %s', async (status) => {
      const { token, productId } = await customerWithOrder(`-rev-${status}`, status);

      const res = await post(token, { productId, rating: 5 });

      // Rejected outright, not accepted and quietly hidden.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('refuses a product the customer has never ordered', async () => {
      const { token } = await customerWithOrder('-rev-never', OrderStatus.DELIVERED);
      const other = await createOrder(ctx.prisma, { total: '100.00' });

      const res = await post(token, { productId: other.productId, rating: 5 });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a second review of the same product', async () => {
      const { token, productId } = await customerWithOrder('-rev-twice', OrderStatus.DELIVERED);

      expect((await post(token, { productId, rating: 5 })).status).toBeLessThan(300);

      const second = await post(token, { productId, rating: 1 });
      expect(second.status).toBe(400);
      expect(String(second.body.message)).toMatch(/already reviewed/i);
    });

    it('refuses an unauthenticated review', async () => {
      const other = await createOrder(ctx.prisma, { total: '100.00' });
      const res = await request(http)
        .post(ctx.url('customer/reviews'))
        .send({ productId: other.productId, rating: 5 });

      expect(res.status).toBe(401);
    });
  });

  describe('validation', () => {
    it.each([0, 6, -1])('rejects a rating of %s', async (rating) => {
      const { token, productId } = await customerWithOrder(
        `-rev-bad${rating}`,
        OrderStatus.DELIVERED,
      );
      expect((await post(token, { productId, rating })).status).toBe(400);
    });

    it('rejects a missing rating', async () => {
      const { token, productId } = await customerWithOrder('-rev-norating', OrderStatus.DELIVERED);
      expect((await post(token, { productId })).status).toBe(400);
    });

    it('rejects a productId that is not a UUID', async () => {
      const { token } = await customerWithOrder('-rev-baduuid', OrderStatus.DELIVERED);
      expect((await post(token, { productId: 'not-a-uuid', rating: 5 })).status).toBe(400);
    });

    it('rejects a comment beyond the 2000-character limit', async () => {
      const { token, productId } = await customerWithOrder('-rev-long', OrderStatus.DELIVERED);
      const res = await post(token, { productId, rating: 5, comment: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('rejects unknown fields rather than ignoring them', async () => {
      // forbidNonWhitelisted - a stray `status: APPROVED` must not sail through.
      const { token, productId } = await customerWithOrder('-rev-extra', OrderStatus.DELIVERED);
      const res = await post(token, { productId, rating: 5, status: 'APPROVED' });
      expect(res.status).toBe(400);
    });
  });

  describe('only approved reviews are public', () => {
    it('does not show a pending review on the product', async () => {
      const { token, productId } = await customerWithOrder('-rev-public', OrderStatus.DELIVERED);
      await post(token, { productId, rating: 5, comment: 'Pending and invisible.' });

      const res = await request(http).get(ctx.url(`products/${productId}/reviews`));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('Pending and invisible.');
    });

    it('shows it once approved', async () => {
      const { token, productId } = await customerWithOrder('-rev-approved', OrderStatus.DELIVERED);
      const created = await post(token, { productId, rating: 5, comment: 'Now visible.' });

      await ctx.prisma.review.update({
        where: { id: created.body.data.id },
        data: { status: 'APPROVED' },
      });

      const res = await request(http).get(ctx.url(`products/${productId}/reviews`));
      expect(JSON.stringify(res.body)).toContain('Now visible.');
    });
  });
});
