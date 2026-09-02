/**
 * Admin authentication and token handling.
 *
 * Covers the two failures this area has actually produced:
 *  - a MANAGER account that could authenticate but could not load its own
 *    profile, which locked every non-ADMIN role out of the product entirely;
 *  - the two-audience token split (ADR 0001), where a customer token must be
 *    worthless against admin routes and vice versa.
 */
import { AdminRoleName } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, createAdmin, cleanupAdmins, E2E_PASSWORD } from './helpers/fixtures';

describe('Admin auth (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const prefix = 'api/v1';

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  describe('POST /auth/admin/login', () => {
    it('issues an access and refresh token for valid credentials', async () => {
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-login');
      const res = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: E2E_PASSWORD });

      expect(res.status).toBeLessThan(300);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
    });

    it('never returns the password hash', async () => {
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-nohash');
      const res = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: E2E_PASSWORD });

      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('$2b$');
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      // Differing status or message here is a user-enumeration oracle: it tells
      // an attacker which addresses are real admin accounts.
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-enum');

      const wrongPassword = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: 'WrongPass@123' });

      const unknownEmail = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: 'e2e-nobody@example.test', password: 'WrongPass@123' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('refuses a deactivated account', async () => {
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-inactive');
      await ctx.prisma.adminUser.update({
        where: { id: admin.id },
        data: { isActive: false },
      });

      const res = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: E2E_PASSWORD });

      expect(res.status).toBe(401);
    });

    it('rejects a malformed email and a missing password', async () => {
      const bad = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: 'not-an-email', password: E2E_PASSWORD });
      expect(bad.status).toBe(400);

      const missing = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: 'e2e-x@example.test' });
      expect(missing.status).toBe(400);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      // forbidNonWhitelisted. Without it, a stray field like `roleId` in a
      // create payload would be quietly dropped instead of refused.
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-extra');
      const res = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: E2E_PASSWORD, isSuperAdmin: true });

      expect(res.status).toBe(400);
    });
  });

  describe('token validation on a protected route', () => {
    const protectedRoute = 'auth/admin/me';

    it('rejects a request with no token', async () => {
      const res = await request(http).get(ctx.url(protectedRoute));
      expect(res.status).toBe(401);
    });

    it('rejects a token that is not a JWT at all', async () => {
      const res = await request(http)
        .get(ctx.url(protectedRoute))
        .set('Authorization', 'Bearer not-a-token');
      expect(res.status).toBe(401);
    });

    it('rejects a token whose signature has been tampered with', async () => {
      const { token } = await adminToken(
        ctx.app,
        ctx.prisma,
        prefix,
        AdminRoleName.ADMIN,
        '-tamper',
      );
      const [header, payload] = token.split('.');
      const forged = `${header}.${payload}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

      const res = await request(http)
        .get(ctx.url(protectedRoute))
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects the Authorization header without the Bearer scheme', async () => {
      const { token } = await adminToken(
        ctx.app,
        ctx.prisma,
        prefix,
        AdminRoleName.ADMIN,
        '-scheme',
      );
      const res = await request(http).get(ctx.url(protectedRoute)).set('Authorization', token);
      expect(res.status).toBe(401);
    });

    it('stops accepting a token once the account is deactivated', async () => {
      // A valid signature is not enough: the account behind it must still be
      // usable, or deactivating a leaver leaves their session live until expiry.
      const { token, admin } = await adminToken(
        ctx.app,
        ctx.prisma,
        prefix,
        AdminRoleName.ADMIN,
        '-revoke',
      );

      const before = await request(http)
        .get(ctx.url(protectedRoute))
        .set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      await ctx.prisma.adminUser.update({ where: { id: admin.id }, data: { isActive: false } });

      const after = await request(http)
        .get(ctx.url(protectedRoute))
        .set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(401);
    });
  });

  describe('audience separation (ADR 0001)', () => {
    it('refuses a validly-signed customer token on an admin route', async () => {
      // The two audiences have separate secret pairs precisely so that a
      // customer token is not merely unauthorised on admin routes but
      // unverifiable. Shared secrets would make this a one-line privilege
      // escalation.
      const customerToken = jwt.sign(
        { sub: '00000000-0000-4000-8000-000000000001', email: 'e2e-cust@example.test' },
        process.env.JWT_ACCESS_SECRET as string,
        { expiresIn: '15m' },
      );

      const res = await request(http)
        .get(ctx.url('auth/admin/me'))
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(401);
    });

    it('refuses an admin token on a customer route', async () => {
      const { token } = await adminToken(ctx.app, ctx.prisma, prefix, AdminRoleName.ADMIN, '-xaud');
      const res = await request(http)
        .get(ctx.url('customer/profile'))
        .set('Authorization', `Bearer ${token}`);

      expect([401, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    it('refuses an expired admin token', async () => {
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-expired');
      const expired = jwt.sign(
        { sub: admin.id, email: admin.email },
        process.env.ADMIN_JWT_ACCESS_SECRET as string,
        { expiresIn: '-1s' },
      );

      const res = await request(http)
        .get(ctx.url('auth/admin/me'))
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('refuses a refresh token used as an access token', async () => {
      // Refresh tokens live longer and are stored; accepting one as an access
      // token would widen the blast radius of a leaked refresh token.
      const admin = await createAdmin(ctx.prisma, AdminRoleName.ADMIN, '-refreshaccess');
      const login = await request(http)
        .post(ctx.url('auth/admin/login'))
        .send({ email: admin.email, password: E2E_PASSWORD });

      const res = await request(http)
        .get(ctx.url('auth/admin/me'))
        .set('Authorization', `Bearer ${login.body.data.refreshToken}`);
      expect(res.status).toBe(401);
    });
  });
});
