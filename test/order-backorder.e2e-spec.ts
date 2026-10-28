/**
 * Backorder and partial fulfilment.
 *
 * One line of an order cannot ship yet. The order is NOT cancelled and no
 * refund is owed - it is fulfilled late, or in two parcels. That makes three
 * things load-bearing, and each has a way of going wrong that nothing throws
 * on:
 *
 *  1. Marking a line unavailable must NOT restock it. The unit is still owed
 *     to this customer; putting it back offers the same jar to somebody else.
 *  2. The order's status must follow from its lines. Set independently, the
 *     two drift and the customer is told the wrong thing.
 *  3. Cash is collected per parcel. Collecting the whole total on the first
 *     delivery charges for a jar that has not arrived.
 */
import { AdminRoleName, OrderStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';
import { createMultiItemOrder, cleanupOrders, MultiItemOrderFixture } from './helpers/orders';

describe('Backorder and partial fulfilment (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(
      ctx.app,
      ctx.prisma,
      'api/v1',
      AdminRoleName.ADMIN,
      '-backorder',
    ));
  });

  afterAll(async () => {
    await cleanupOrders(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

  const setAvailability = (orderId: string, itemId: string, body: Record<string, unknown>) =>
    request(http)
      .patch(ctx.url(`admin/orders/${orderId}/items/${itemId}/availability`))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const setStatus = (orderId: string, status: OrderStatus) =>
    request(http)
      .patch(ctx.url(`admin/orders/${orderId}/status`))
      .set('Authorization', `Bearer ${token}`)
      .send({ status });

  const getOrder = (orderId: string) =>
    request(http)
      .get(ctx.url(`admin/orders/${orderId}`))
      .set('Authorization', `Bearer ${token}`);

  /** A two-line order, 200 + 120, plus 40 delivery. */
  const twoLines = (opts: Record<string, unknown> = {}) =>
    createMultiItemOrder(ctx.prisma, {
      lineTotals: ['200.00', '120.00'],
      shippingAmount: '40.00',
      status: 'PROCESSING',
      ...opts,
    });

  // -------------------------------------------------------------------------

  describe('marking a line unavailable', () => {
    let order: MultiItemOrderFixture;

    beforeEach(async () => {
      order = await twoLines();
    });

    it('records the date and the note on that line only', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        availabilityNote: 'The new batch is still curing.',
      });

      expect(res.status).toBe(200);
      const items = res.body.data.items;
      const held = items.find((i: any) => i.id === order.itemIds[0]);
      const other = items.find((i: any) => i.id === order.itemIds[1]);

      expect(held.fulfilmentStatus).toBe('AWAITING_STOCK');
      expect(held.expectedAvailabilityDate).toBeTruthy();
      expect(held.availabilityNote).toBe('The new batch is still curing.');
      expect(other.fulfilmentStatus).toBe('PENDING');
      expect(other.expectedAvailabilityDate).toBeNull();
    });

    it('does NOT put the stock back', async () => {
      // The whole trap. The unit was decremented at checkout and is still owed
      // to this customer - restocking it offers the same jar to somebody else,
      // and the shop finds out at the second customer's doorstep.
      const before = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: order.productIds[0] },
        select: { stockQuantity: true },
      });

      await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
      });

      const after = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: order.productIds[0] },
        select: { stockQuantity: true },
      });
      expect(after.stockQuantity).toBe(before.stockQuantity);
    });

    it('does not cancel the order or touch its money', async () => {
      // Stated plainly because it is the requirement: no cancellation, no
      // refund, no change to what is owed.
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: true,
      });

      expect(res.body.data.status).not.toBe('CANCELLED');
      expect(res.body.data.cancelledAt).toBeNull();
      expect(res.body.data.totalAmount).toBe('360');
      expect(res.body.data.refunds ?? []).toHaveLength(0);
    });

    it('holds the whole order when asked to', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: true,
      });

      expect(res.body.data.status).toBe('AWAITING_STOCK');
      expect(res.body.data.holdForStock).toBe(true);
    });

    it('leaves the order moving when told to ship the rest', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: false,
      });

      expect(res.body.data.status).toBe('PROCESSING');
      expect(res.body.data.holdForStock).toBe(false);
    });

    it('awaits stock when every line is held, whatever the choice', async () => {
      // Nothing to split off, so hold-or-split cannot apply.
      await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: false,
      });
      const res = await setAvailability(order.orderId, order.itemIds[1], {
        available: false,
        expectedAvailabilityDate: inDays(6),
        holdForStock: false,
      });

      expect(res.body.data.status).toBe('AWAITING_STOCK');
    });

    it('writes a history entry a human can read', async () => {
      await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: true,
      });

      const res = await getOrder(order.orderId);
      const notes = res.body.data.statusHistory.map((h: any) => h.note).join(' | ');
      expect(notes).toMatch(/out of stock until/i);
    });
  });

  describe('validation', () => {
    let order: MultiItemOrderFixture;

    beforeEach(async () => {
      order = await twoLines();
    });

    it('refuses to mark a line unavailable with no date', async () => {
      // "We don't have it" without a date is worse than saying nothing.
      const res = await setAvailability(order.orderId, order.itemIds[0], { available: false });
      expect(res.status).toBe(400);
    });

    it('refuses a date in the past', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(-2),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/future/i);
    });

    it('refuses a date that is not a date', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: 'next Tuesday-ish',
      });
      expect(res.status).toBe(400);
    });

    it('refuses an unknown field', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        refundIt: true,
      });
      expect(res.status).toBe(400);
    });

    it('404s for a line that is not on this order', async () => {
      const other = await twoLines();
      const res = await setAvailability(order.orderId, other.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
      });
      expect(res.status).toBe(404);
    });

    it('refuses to reschedule a cancelled order', async () => {
      await setStatus(order.orderId, 'CANCELLED');
      const res = await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
      });
      expect(res.status).toBe(400);
    });

    it('needs authentication', async () => {
      const res = await request(http)
        .patch(ctx.url(`admin/orders/${order.orderId}/items/${order.itemIds[0]}/availability`))
        .send({ available: false, expectedAvailabilityDate: inDays(4) });
      expect(res.status).toBe(401);
    });
  });

  describe('a held order', () => {
    let order: MultiItemOrderFixture;

    beforeEach(async () => {
      order = await twoLines();
      await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: true,
      });
    });

    it('refuses to be packed, naming what it is waiting for', async () => {
      const res = await setStatus(order.orderId, 'PACKED');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/waiting on/i);
    });

    it('can still be cancelled, which is often what the customer asks for', async () => {
      const res = await setStatus(order.orderId, 'CANCELLED');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('moves again once the line is marked available', async () => {
      const cleared = await setAvailability(order.orderId, order.itemIds[0], { available: true });

      expect(cleared.body.data.status).toBe('PROCESSING');
      expect(cleared.body.data.holdForStock).toBe(false);
      expect(cleared.body.data.items.every((i: any) => i.fulfilmentStatus === 'PENDING')).toBe(
        true,
      );

      const packed = await setStatus(order.orderId, 'PACKED');
      expect(packed.body.data.status).toBe('PACKED');
    });

    it('clears the date and note when the line comes back', async () => {
      const res = await setAvailability(order.orderId, order.itemIds[0], { available: true });
      const line = res.body.data.items.find((i: any) => i.id === order.itemIds[0]);
      expect(line.expectedAvailabilityDate).toBeNull();
      expect(line.availabilityNote).toBeNull();
    });
  });

  describe('a split order', () => {
    let order: MultiItemOrderFixture;

    beforeEach(async () => {
      order = await twoLines();
      // Line 0 (200.00) is held; line 1 (120.00) ships now.
      await setAvailability(order.orderId, order.itemIds[0], {
        available: false,
        expectedAvailabilityDate: inDays(4),
        holdForStock: false,
      });
    });

    it('ships only the available line, and says the order is partially shipped', async () => {
      await setStatus(order.orderId, 'PACKED');
      const res = await setStatus(order.orderId, 'SHIPPED');

      expect(res.body.data.status).toBe('PARTIALLY_SHIPPED');
      const items = res.body.data.items;
      expect(items.find((i: any) => i.id === order.itemIds[0]).fulfilmentStatus).toBe(
        'AWAITING_STOCK',
      );
      expect(items.find((i: any) => i.id === order.itemIds[1]).fulfilmentStatus).toBe('SHIPPED');
    });

    it('explains in the history why it did not become SHIPPED', async () => {
      // Otherwise it reads as a bug: someone pressed "Shipped" and got
      // something else.
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');

      const res = await getOrder(order.orderId);
      const last = res.body.data.statusHistory.at(-1);
      expect(last.status).toBe('PARTIALLY_SHIPPED');
      expect(last.note).toMatch(/still to follow/i);
    });

    it('collects only the first parcel’s value, plus delivery', async () => {
      // 120.00 for the line, plus the 40.00 delivery charge that rides on the
      // first parcel. NOT the 360.00 order total - the customer has not
      // received the 200.00 jar.
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      expect(res.body.data.payments).toHaveLength(1);
      expect(Number(res.body.data.payments[0].amount)).toBeCloseTo(160, 2);
      expect(res.body.data.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('is still partially shipped after the first parcel lands', async () => {
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      // One line delivered, one still owed - the order is not done.
      expect(res.body.data.status).toBe('PARTIALLY_SHIPPED');
    });

    it('completes when the second parcel is delivered, collecting the rest', async () => {
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      await setStatus(order.orderId, 'DELIVERED');

      // The held line arrives.
      await setAvailability(order.orderId, order.itemIds[0], { available: true });
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.paymentStatus).toBe('PAID');

      const collected = res.body.data.payments.reduce(
        (sum: number, p: any) => sum + Number(p.amount),
        0,
      );
      // The property that matters: splitting a delivery must not change what
      // the customer pays in total.
      expect(collected).toBeCloseTo(360, 2);
      expect(res.body.data.payments).toHaveLength(2);
    });

    it('charges delivery once across both parcels', async () => {
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      await setStatus(order.orderId, 'DELIVERED');
      await setAvailability(order.orderId, order.itemIds[0], { available: true });
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      const second = res.body.data.payments.at(-1);
      // The second parcel pays for its line only. Prorating one delivery fee
      // across two parcels would invent a second fee.
      expect(Number(second.amount)).toBeCloseTo(200, 2);
    });

    it('marks every line delivered at the end', async () => {
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      await setStatus(order.orderId, 'DELIVERED');
      await setAvailability(order.orderId, order.itemIds[0], { available: true });
      await setStatus(order.orderId, 'SHIPPED');
      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      expect(res.body.data.items.every((i: any) => i.fulfilmentStatus === 'DELIVERED')).toBe(true);
    });

    it('refuses to reschedule a line that has already gone out', async () => {
      await setStatus(order.orderId, 'PACKED');
      await setStatus(order.orderId, 'SHIPPED');

      const res = await setAvailability(order.orderId, order.itemIds[1], {
        available: false,
        expectedAvailabilityDate: inDays(4),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/dispatched/i);
    });
  });

  describe('an ordinary order is untouched', () => {
    it('ships and delivers exactly as before, collecting once', async () => {
      // The regression that would matter most: this feature must not change
      // what happens to the orders that have no backorder at all.
      const order = await twoLines();

      await setStatus(order.orderId, 'PACKED');
      const shipped = await setStatus(order.orderId, 'SHIPPED');
      expect(shipped.body.data.status).toBe('SHIPPED');

      await setStatus(order.orderId, 'OUT_FOR_DELIVERY');
      const res = await setStatus(order.orderId, 'DELIVERED');

      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.payments).toHaveLength(1);
      expect(Number(res.body.data.payments[0].amount)).toBeCloseTo(360, 2);
      expect(res.body.data.paymentStatus).toBe('PAID');
    });

    it('still rejects an illegal status jump', async () => {
      const order = await twoLines();
      const res = await setStatus(order.orderId, 'DELIVERED');
      expect(res.status).toBe(400);
    });

    it('still restocks on cancellation', async () => {
      const order = await twoLines();
      const before = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: order.productIds[0] },
        select: { stockQuantity: true },
      });

      await setStatus(order.orderId, 'CANCELLED');

      const after = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: order.productIds[0] },
        select: { stockQuantity: true },
      });
      expect(after.stockQuantity).toBe(before.stockQuantity + 1);
    });
  });
});
