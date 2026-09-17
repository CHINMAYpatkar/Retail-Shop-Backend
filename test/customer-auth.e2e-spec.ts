/**
 * Customer authentication and the profile endpoint.
 *
 * `GET auth/customer/me` exists because without it the storefront can complete
 * an OTP login, hold a valid token, and still not know who it is signed in as.
 * That is the exact failure the admin side hit, where every non-ADMIN role
 * could authenticate but not read its own profile and was locked out of the
 * product entirely - so the first spec here is that every authenticated
 * customer can read their own identity, with no further gate.
 */
import { AdminRoleName, OtpPurpose } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';
import {
  E2E_OTP,
  cleanupCustomers,
  createVerifiedCustomer,
  customerToken,
  plantOtp,
} from './helpers/customers';

describe('Customer auth (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const prefix = 'api/v1';

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupCustomers(ctx.prisma);
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  describe('POST login/verify', () => {
    it('issues a token pair for a valid code', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-login');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const res = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a wrong code', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-wrongcode');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const res = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: customer.email, code: '000000' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
    });

    it('refuses to reuse a code that has already been consumed', async () => {
      // A single-use code that still works is a code that can be replayed from
      // an inbox or a shoulder-surf long after the customer has finished.
      const customer = await createVerifiedCustomer(ctx.prisma, '-replay');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const first = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: customer.email, code: E2E_OTP });
      expect(first.status).toBe(200);

      const second = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: customer.email, code: E2E_OTP });
      expect(second.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects an expired code', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-expired');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);
      await ctx.prisma.otpCode.updateMany({
        where: { email: customer.email, purpose: OtpPurpose.LOGIN },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a malformed request', async () => {
      const res = await request(http)
        .post(ctx.url('auth/customer/login/verify'))
        .send({ email: 'not-an-email', code: E2E_OTP });
      expect(res.status).toBe(400);
    });
  });

  describe('GET auth/customer/me', () => {
    it('returns the signed-in customer to any authenticated customer', async () => {
      // The whole point of the endpoint. No role, no permission, no further
      // gate - a valid customer token IS the authorisation.
      const { token, customer } = await customerToken(ctx.app, ctx.prisma, prefix, '-me');

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: customer.id,
        email: customer.email,
        isVerified: true,
      });
    });

    it('never exposes a password hash', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-nohash');

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`);

      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('$2b$');
    });

    it('reports a boolean rather than the verification timestamp', async () => {
      // The storefront only needs to know whether the address is confirmed;
      // when it happened is not its business.
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-bool');

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.data.isVerified).toBe(true);
      expect(res.body.data).not.toHaveProperty('emailVerifiedAt');
    });

    it('rejects a request with no token', async () => {
      expect((await request(http).get(ctx.url('auth/customer/me'))).status).toBe(401);
    });

    it('rejects a tampered token', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-tamper');
      const [header, payload] = token.split('.');

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${header}.${payload}.aaaaaaaaaaaaaaaaaaaaaaaaaaa`);
      expect(res.status).toBe(401);
    });

    it('stops accepting a token once the account is deactivated', async () => {
      // A valid signature is not enough. Without this, deactivating a customer
      // leaves their session live until the token expires on its own.
      const { token, customer } = await customerToken(ctx.app, ctx.prisma, prefix, '-deact');

      expect(
        (
          await request(http)
            .get(ctx.url('auth/customer/me'))
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(200);

      await ctx.prisma.customer.update({
        where: { id: customer.id },
        data: { isActive: false },
      });

      const after = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
    });
  });

  describe('audience separation (ADR 0001), from the customer side', () => {
    it('refuses an admin token on the customer profile route', async () => {
      // The mirror of the admin-side spec. The two audiences have separate
      // secret pairs, so an admin token is not merely unauthorised here - it is
      // unverifiable. Shared secrets would make this a one-line escalation.
      const { token } = await adminToken(
        ctx.app,
        ctx.prisma,
        prefix,
        AdminRoleName.SUPER_ADMIN,
        '-xaud-cust',
      );

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it('refuses a customer token on an admin route', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-xaud-admin');

      const res = await request(http)
        .get(ctx.url('auth/admin/me'))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it('refuses a customer refresh token used as an access token', async () => {
      const { refreshToken } = await customerToken(ctx.app, ctx.prisma, prefix, '-refreshaccess');

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${refreshToken}`);
      expect(res.status).toBe(401);
    });
  });
});
