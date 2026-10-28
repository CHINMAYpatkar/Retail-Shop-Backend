/**
 * Support tickets.
 *
 * The contact form posts here. Two routes on purpose: the public one, because
 * somebody with a delivery problem should not have to make an account first;
 * and the authenticated one, which attaches the ticket to the customer so the
 * reply is readable on the site rather than only in their inbox.
 *
 * The property that matters is the boundary between them - a ticket raised
 * anonymously must NOT appear in anyone's account, and one customer must never
 * read another's thread.
 */
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { E2E_TAG, cleanupAdmins } from './helpers/fixtures';
import { cleanupCustomers, customerToken } from './helpers/customers';

describe('Support tickets (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const prefix = 'api/v1';

  const body = {
    name: 'Test Person',
    email: `${E2E_TAG}support@example.test`,
    subject: 'Order arrived damaged',
    message: 'The jar was cracked on arrival.',
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    const tickets = await ctx.prisma.supportTicket.findMany({
      where: { OR: [{ email: { startsWith: E2E_TAG } }, { subject: { startsWith: E2E_TAG } }] },
      select: { id: true },
    });
    const ids = tickets.map((t) => t.id);
    if (ids.length) {
      await ctx.prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ids } } });
      await ctx.prisma.supportTicket.deleteMany({ where: { id: { in: ids } } });
    }
    await cleanupCustomers(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  describe('anyone can raise a ticket without an account', () => {
    it('accepts a ticket and returns a reference number', async () => {
      const res = await request(http).post(ctx.url('support/tickets')).send(body);

      expect(res.status).toBeLessThan(300);
      // The reference is the only thing an anonymous sender can quote back.
      expect(res.body.data.ticketNumber).toEqual(expect.any(String));
      expect(res.body.data.status).toBe('OPEN');
    });

    it('stores the first message on the thread', async () => {
      const res = await request(http).post(ctx.url('support/tickets')).send(body);
      expect(res.body.data.messages).toHaveLength(1);
      expect(res.body.data.messages[0].message).toBe(body.message);
    });

    it('leaves it unattached to any account', async () => {
      const res = await request(http).post(ctx.url('support/tickets')).send(body);
      expect(res.body.data.customerId).toBeNull();
    });

    it.each([
      ['a malformed email', { ...body, email: 'not-an-email' }],
      ['a missing subject', { name: body.name, email: body.email, message: body.message }],
      ['a missing message', { name: body.name, email: body.email, subject: body.subject }],
      ['a one-character name', { ...body, name: 'x' }],
      ['an over-long message', { ...body, message: 'x'.repeat(4001) }],
    ])('rejects %s', async (_label, payload) => {
      expect((await request(http).post(ctx.url('support/tickets')).send(payload)).status).toBe(400);
    });
  });

  describe('a signed-in customer gets a thread they can follow', () => {
    it('attaches the ticket to the account', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-attach');

      const res = await request(http)
        .post(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(res.status).toBeLessThan(300);
      expect(res.body.data.customerId).toEqual(expect.any(String));
    });

    it('lists only that customer own tickets', async () => {
      const a = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-a');
      const b = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-b');

      await request(http)
        .post(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${a.token}`)
        .send({ ...body, subject: `${E2E_TAG}belongs-to-a` });

      const mine = await request(http)
        .get(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${b.token}`);

      expect(mine.status).toBe(200);
      expect(JSON.stringify(mine.body)).not.toContain('belongs-to-a');
    });

    it('refuses to open another customer thread', async () => {
      const a = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-owner');
      const b = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-intruder');

      const created = await request(http)
        .post(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${a.token}`)
        .send(body);

      const res = await request(http)
        .get(ctx.url(`customer/support/tickets/${created.body.data.id}`))
        .set('Authorization', `Bearer ${b.token}`);

      expect(res.status).not.toBe(200);
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('does NOT show an anonymous ticket in an account with the same email', async () => {
      // The boundary that matters: raising a ticket signed out must not expose
      // it to whoever later signs in with that address.
      const { token, customer } = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-anon');

      await request(http)
        .post(ctx.url('support/tickets'))
        .send({ ...body, email: customer.email, subject: `${E2E_TAG}raised-anonymously` });

      const mine = await request(http)
        .get(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${token}`);

      expect(JSON.stringify(mine.body)).not.toContain('raised-anonymously');
    });

    it('appends a reply to the thread', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-reply');
      const created = await request(http)
        .post(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      const res = await request(http)
        .post(ctx.url(`customer/support/tickets/${created.body.data.id}/messages`))
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'Adding the order number: RS-123.' });

      expect(res.status).toBeLessThan(300);

      const thread = await request(http)
        .get(ctx.url(`customer/support/tickets/${created.body.data.id}`))
        .set('Authorization', `Bearer ${token}`);

      expect(thread.body.data.messages).toHaveLength(2);
    });

    it('refuses to reply to another customer thread', async () => {
      const a = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-rowner');
      const b = await customerToken(ctx.app, ctx.prisma, prefix, '-sup-rintruder');

      const created = await request(http)
        .post(ctx.url('customer/support/tickets'))
        .set('Authorization', `Bearer ${a.token}`)
        .send(body);

      const res = await request(http)
        .post(ctx.url(`customer/support/tickets/${created.body.data.id}/messages`))
        .set('Authorization', `Bearer ${b.token}`)
        .send({ message: 'Should not land.' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('requires authentication to list tickets', async () => {
      expect((await request(http).get(ctx.url('customer/support/tickets'))).status).toBe(401);
    });
  });
});
