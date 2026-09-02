/**
 * Purchase bills: stock movement and weighted-average cost.
 *
 * The service comment calls the edit path "the routine most likely to corrupt
 * data silently", and it is right - a partial reversal leaves stock and cost
 * quietly wrong, and unlike a broken order there is no customer to complain.
 * Two different strategies are in play and both are asserted here:
 *
 *  - Stock is DELTA-based: purchases add, edits reverse then reapply.
 *  - Average cost is RECOMPUTED FROM HISTORY, never reverse-subtracted, because
 *    a moving average is not exactly invertible.
 *
 * This is also the area that was corrupted for real once, when mutating tests
 * were pointed at the dev database and overwrote a material's average cost.
 */
import { AdminRoleName, MeasurementUnit } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins, E2E_TAG } from './helpers/fixtures';

describe('Purchase bills (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;
  let vendorId: string;
  let billSeq = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', AdminRoleName.ADMIN, '-bills'));

    const vendor = await ctx.prisma.vendor.create({
      data: { name: `${E2E_TAG}Vendor`, phone: '9999999999' },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await cleanup();
    await ctx.prisma.vendor.deleteMany({ where: { name: { startsWith: E2E_TAG } } });
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  async function cleanup() {
    const bills = await ctx.prisma.purchaseBill.findMany({
      where: { billNumber: { startsWith: E2E_TAG } },
      select: { id: true },
    });
    const ids = bills.map((b) => b.id);
    if (ids.length) {
      await ctx.prisma.vendorPayment.deleteMany({ where: { purchaseBillId: { in: ids } } });
      await ctx.prisma.purchaseBillItem.deleteMany({ where: { purchaseBillId: { in: ids } } });
      await ctx.prisma.purchaseBill.deleteMany({ where: { id: { in: ids } } });
    }
    await ctx.prisma.rawMaterial.deleteMany({ where: { name: { startsWith: E2E_TAG } } });
  }

  async function makeMaterial(label: string) {
    return ctx.prisma.rawMaterial.create({
      data: {
        name: `${E2E_TAG}${label}`,
        baseUnit: MeasurementUnit.KILOGRAM,
        stockQuantity: 0,
      },
    });
  }

  function billBody(items: { rawMaterialId: string; quantity: number; unitPrice: number }[]) {
    billSeq += 1;
    return {
      vendorId,
      billNumber: `${E2E_TAG}BILL-${String(billSeq).padStart(4, '0')}`,
      billDate: '2026-09-01',
      items,
    };
  }

  const createBill = (body: Record<string, unknown>) =>
    request(http)
      .post(ctx.url('admin/purchase-bills'))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const updateBill = (id: string, body: Record<string, unknown>) =>
    request(http)
      .patch(ctx.url(`admin/purchase-bills/${id}`))
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const deleteBill = (id: string) =>
    request(http)
      .delete(ctx.url(`admin/purchase-bills/${id}`))
      .set('Authorization', `Bearer ${token}`);

  const material = (id: string) => ctx.prisma.rawMaterial.findUnique({ where: { id } });

  describe('recording a bill', () => {
    it('adds the purchased quantity to stock and sets the average cost', async () => {
      const m = await makeMaterial('turmeric');
      const res = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 200 }]),
      );

      expect(res.status).toBeLessThan(300);
      const after = await material(m.id);
      expect(Number(after!.stockQuantity)).toBe(10);
      expect(Number(after!.avgCostPerUnit)).toBe(200);
    });

    it('computes the total from the lines rather than trusting the client', async () => {
      const m = await makeMaterial('chilli');
      const res = await createBill(
        billBody([
          { rawMaterialId: m.id, quantity: 2, unitPrice: 150 },
          { rawMaterialId: m.id, quantity: 3, unitPrice: 100 },
        ]),
      );

      expect(Number(res.body.data.subtotal)).toBe(600);
      expect(Number(res.body.data.totalAmount)).toBe(600);
    });

    it('weights the average by quantity across separate bills', async () => {
      const m = await makeMaterial('cumin');
      await createBill(billBody([{ rawMaterialId: m.id, quantity: 1, unitPrice: 100 }]));
      await createBill(billBody([{ rawMaterialId: m.id, quantity: 9, unitPrice: 200 }]));

      const after = await material(m.id);
      expect(Number(after!.stockQuantity)).toBe(10);
      // 1900/10 = 190. A plain mean of the two bills would say 150.
      expect(Number(after!.avgCostPerUnit)).toBe(190);
    });

    it('refuses a duplicate bill number for the same vendor', async () => {
      const m = await makeMaterial('coriander');
      const body = billBody([{ rawMaterialId: m.id, quantity: 1, unitPrice: 10 }]);

      expect((await createBill(body)).status).toBeLessThan(300);
      const dup = await createBill(body);
      expect([400, 409]).toContain(dup.status);
    });

    it('refuses a due date earlier than the bill date', async () => {
      const m = await makeMaterial('pepper');
      const body = {
        ...billBody([{ rawMaterialId: m.id, quantity: 1, unitPrice: 10 }]),
        dueDate: '2026-08-01',
      };
      expect((await createBill(body)).status).toBe(400);
    });

    it('refuses an unknown raw material', async () => {
      const body = billBody([
        { rawMaterialId: '00000000-0000-4000-8000-000000000404', quantity: 1, unitPrice: 10 },
      ]);
      expect([400, 404]).toContain((await createBill(body)).status);
    });

    it('refuses a bill with no lines', async () => {
      expect((await createBill(billBody([]))).status).toBe(400);
    });
  });

  describe('editing a bill reverses the old effect before applying the new one', () => {
    it('adjusts stock by the difference, not by the new quantity', async () => {
      const m = await makeMaterial('fennel');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 100 }]),
      );
      expect(Number((await material(m.id))!.stockQuantity)).toBe(10);

      await updateBill(created.body.data.id, {
        items: [{ rawMaterialId: m.id, quantity: 4, unitPrice: 100 }],
      });

      // 4, not 14 (forgot to reverse) and not -6 (reversed twice).
      expect(Number((await material(m.id))!.stockQuantity)).toBe(4);
    });

    it('recomputes the average cost from history rather than reverse-subtracting', async () => {
      const m = await makeMaterial('clove');
      const first = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 100 }]),
      );
      await createBill(billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 300 }]));
      expect(Number((await material(m.id))!.avgCostPerUnit)).toBe(200);

      // Correct the first bill's price. The answer must be the average of the
      // corrected history (10@50 + 10@300 = 3500/20 = 175), which is only
      // reachable by recomputing - unwinding a moving average cannot get here.
      await updateBill(first.body.data.id, {
        items: [{ rawMaterialId: m.id, quantity: 10, unitPrice: 50 }],
      });

      expect(Number((await material(m.id))!.avgCostPerUnit)).toBe(175);
    });

    it('restores the exact original figures when an edit is undone', async () => {
      // The property that matters most: an edit and its reversal must be a
      // no-op. Any drift here compounds silently over every future correction.
      const m = await makeMaterial('cardamom');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 7, unitPrice: 123.4567 }]),
      );
      const original = await material(m.id);

      await updateBill(created.body.data.id, {
        items: [{ rawMaterialId: m.id, quantity: 3, unitPrice: 999.9999 }],
      });
      await updateBill(created.body.data.id, {
        items: [{ rawMaterialId: m.id, quantity: 7, unitPrice: 123.4567 }],
      });

      const restored = await material(m.id);
      expect(restored!.stockQuantity.toString()).toBe(original!.stockQuantity.toString());
      expect(restored!.avgCostPerUnit!.toString()).toBe(original!.avgCostPerUnit!.toString());
    });

    it('reverses stock for a line removed from the bill', async () => {
      const a = await makeMaterial('bay-leaf');
      const b = await makeMaterial('mace');
      const created = await createBill(
        billBody([
          { rawMaterialId: a.id, quantity: 5, unitPrice: 100 },
          { rawMaterialId: b.id, quantity: 8, unitPrice: 100 },
        ]),
      );

      await updateBill(created.body.data.id, {
        items: [{ rawMaterialId: a.id, quantity: 5, unitPrice: 100 }],
      });

      expect(Number((await material(a.id))!.stockQuantity)).toBe(5);
      // The dropped line must be unwound, not merely left out of the new total.
      expect(Number((await material(b.id))!.stockQuantity)).toBe(0);
    });

    it('leaves stock untouched when only bill metadata changes', async () => {
      const m = await makeMaterial('star-anise');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 6, unitPrice: 100 }]),
      );

      await updateBill(created.body.data.id, { notes: 'paid by cheque' });

      expect(Number((await material(m.id))!.stockQuantity)).toBe(6);
    });
  });

  describe('deleting a bill', () => {
    it('reverses its stock effect', async () => {
      const m = await makeMaterial('nutmeg');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 12, unitPrice: 100 }]),
      );
      expect(Number((await material(m.id))!.stockQuantity)).toBe(12);

      expect((await deleteBill(created.body.data.id)).status).toBeLessThan(300);
      expect(Number((await material(m.id))!.stockQuantity)).toBe(0);
    });

    it('recomputes the average cost from the bills that remain', async () => {
      const m = await makeMaterial('asafoetida');
      await createBill(billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 100 }]));
      const second = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 300 }]),
      );
      expect(Number((await material(m.id))!.avgCostPerUnit)).toBe(200);

      await deleteBill(second.body.data.id);
      expect(Number((await material(m.id))!.avgCostPerUnit)).toBe(100);
    });

    it('refuses to delete a bill that has payments recorded against it', async () => {
      // Deleting it would strand the payment against nothing and break the
      // vendor ledger.
      const m = await makeMaterial('saffron');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 1, unitPrice: 5000 }]),
      );
      const billId = created.body.data.id;

      await ctx.prisma.vendorPayment.create({
        data: {
          vendorId,
          purchaseBillId: billId,
          amount: 1000,
          paidOn: new Date('2026-09-02'),
          method: 'BANK_TRANSFER',
        },
      });

      const res = await deleteBill(billId);
      expect(res.status).toBe(409);
      expect(await ctx.prisma.purchaseBill.findUnique({ where: { id: billId } })).not.toBeNull();
      // And the reversal must NOT have been half-applied.
      expect(Number((await material(m.id))!.stockQuantity)).toBe(1);
    });
  });

  describe('payment status is derived, never stored stale', () => {
    it('moves UNPAID to PARTIALLY_PAID to PAID as payments are recorded', async () => {
      const m = await makeMaterial('ajwain');
      const created = await createBill(
        billBody([{ rawMaterialId: m.id, quantity: 10, unitPrice: 100 }]),
      );
      const billId = created.body.data.id;

      const read = async () => {
        const res = await request(http)
          .get(ctx.url(`admin/purchase-bills/${billId}`))
          .set('Authorization', `Bearer ${token}`);
        return res.body.data;
      };

      // The derived field is `status` (payment status of the BILL), alongside
      // the derived `paidAmount` and `outstandingAmount`.
      expect((await read()).status).toBe('UNPAID');

      const pay = (amount: number) =>
        ctx.prisma.vendorPayment.create({
          data: {
            vendorId,
            purchaseBillId: billId,
            amount,
            paidOn: new Date('2026-09-02'),
            method: 'CASH',
          },
        });

      await pay(400);
      const partial = await read();
      expect(Number(partial.paidAmount)).toBe(400);
      expect(Number(partial.outstandingAmount)).toBe(600);
      expect((await read()).status).toBe('PARTIALLY_PAID');

      await pay(600);
      expect((await read()).status).toBe('PAID');
    });
  });
});
