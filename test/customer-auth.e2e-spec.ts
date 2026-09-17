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
import { E2E_TAG, adminToken, cleanupAdmins } from './helpers/fixtures';
import {
  E2E_OTP,
  REFRESH_COOKIE,
  cleanupCustomers,
  cookieFrom,
  createVerifiedCustomer,
  customerToken,
  newCustomerOtp,
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

  describe('POST otp/verify', () => {
    it('issues a token pair for a valid code', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-login');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const res = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));

      // The refresh token is deliberately NOT in the body - it is an httpOnly
      // cookie, so that a script cannot read it and walk away with the session.
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(cookieFrom(res, REFRESH_COOKIE)).toBeTruthy();
    });

    it('rejects a wrong code', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-wrongcode');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const res = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
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
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: customer.email, code: E2E_OTP });
      expect(first.status).toBe(200);

      const second = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
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
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a malformed request', async () => {
      const res = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
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
      const { refreshCookie } = await customerToken(ctx.app, ctx.prisma, prefix, '-refreshaccess');
      expect(refreshCookie).toBeTruthy();

      const res = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${refreshCookie}`);
      expect(res.status).toBe(401);
    });
  });

  describe('the sign-in request tells an attacker nothing (BE-17)', () => {
    /**
     * The whole reason register and login were merged. Previously
     * `login/request-otp` answered 200 for a registered address and 404 for an
     * unknown one, which let anyone enumerate the shop's customer list, and
     * `register` leaked the same fact in reverse.
     */
    it('answers a registered and an unregistered address identically', async () => {
      const known = await createVerifiedCustomer(ctx.prisma, '-enum-known');

      const registered = await request(http)
        .post(ctx.url('auth/customer/otp/request'))
        .send({ email: known.email });

      const unknown = await request(http)
        .post(ctx.url('auth/customer/otp/request'))
        .send({ email: `${E2E_TAG}never-seen@example.test` });

      expect(registered.status).toBe(200);
      expect(unknown.status).toBe(200);
      // Same status AND same body. A differing message is the same oracle in
      // a different wrapper.
      expect(registered.body.data).toEqual(unknown.body.data);
    });

    it('answers identically for a deactivated account', async () => {
      const disabled = await createVerifiedCustomer(ctx.prisma, '-enum-disabled');
      await ctx.prisma.customer.update({
        where: { id: disabled.id },
        data: { isActive: false },
      });

      const res = await request(http)
        .post(ctx.url('auth/customer/otp/request'))
        .send({ email: disabled.email });
      const control = await request(http)
        .post(ctx.url('auth/customer/otp/request'))
        .send({ email: `${E2E_TAG}never-seen-2@example.test` });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(control.body.data);
    });

    it('issues no code at all for a deactivated account', async () => {
      const disabled = await createVerifiedCustomer(ctx.prisma, '-enum-nocode');
      await ctx.prisma.customer.update({
        where: { id: disabled.id },
        data: { isActive: false },
      });
      await ctx.prisma.otpCode.deleteMany({ where: { email: disabled.email } });

      await request(http)
        .post(ctx.url('auth/customer/otp/request'))
        .send({ email: disabled.email });

      expect(await ctx.prisma.otpCode.count({ where: { email: disabled.email } })).toBe(0);
    });

    it('does not distinguish a wrong code from an unknown address on verify', async () => {
      const known = await createVerifiedCustomer(ctx.prisma, '-enum-verify');
      await plantOtp(ctx.prisma, known.email, OtpPurpose.LOGIN, E2E_OTP, known.id);

      const wrongCode = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: known.email, code: '000000' });

      const unknownEmail = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: `${E2E_TAG}nobody@example.test`, code: '000000' });

      expect(wrongCode.status).toBe(unknownEmail.status);
    });
  });

  describe('the two branches: returning customer vs first-time', () => {
    it('signs a returning customer straight in', async () => {
      const { body } = await customerToken(ctx.app, ctx.prisma, prefix, '-returning');

      expect(body.isNewCustomer).toBe(false);
      expect(body.accessToken).toEqual(expect.any(String));
    });

    it('flags a first-time address as new, with an incomplete profile', async () => {
      const { email } = await newCustomerOtp(ctx.prisma, '-first');

      const res = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email, code: E2E_OTP });

      expect(res.status).toBe(200);
      expect(res.body.data.isNewCustomer).toBe(true);
      expect(res.body.data.profileComplete).toBe(false);
      // Signed in regardless: abandoning the registration form must leave a
      // usable account, not a dead half-record.
      expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('marks the email verified from the moment the code is accepted', async () => {
      const { email } = await newCustomerOtp(ctx.prisma, '-verified');

      await request(http).post(ctx.url('auth/customer/otp/verify')).send({ email, code: E2E_OTP });

      const row = await ctx.prisma.customer.findUnique({ where: { email } });
      expect(row?.emailVerifiedAt).not.toBeNull();
    });

    it('does not re-stamp emailVerifiedAt on a later sign-in', async () => {
      // It records when the address was confirmed, not when they last signed in.
      const customer = await createVerifiedCustomer(ctx.prisma, '-stamp');
      const before = await ctx.prisma.customer.findUnique({ where: { id: customer.id } });

      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);
      await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      const after = await ctx.prisma.customer.findUnique({ where: { id: customer.id } });
      expect(after?.emailVerifiedAt?.toISOString()).toBe(before?.emailVerifiedAt?.toISOString());
      expect(after?.lastLoginAt).not.toBeNull();
    });
  });

  describe('PATCH me - completing registration', () => {
    it('saves name and phone, and marks the profile complete', async () => {
      const { email } = await newCustomerOtp(ctx.prisma, '-complete');
      const signIn = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email, code: E2E_OTP });

      const token = signIn.body.data.accessToken;

      const res = await request(http)
        .patch(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Chinmay Patkar', phone: '+91 98765 43210' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: 'Chinmay Patkar',
        phone: '+91 98765 43210',
        email,
      });
    });

    it('trims whitespace rather than storing it', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-trim');

      const res = await request(http)
        .patch(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '  Chinmay  ', phone: '  9876543210  ' });

      expect(res.body.data.name).toBe('Chinmay');
      expect(res.body.data.phone).toBe('9876543210');
    });

    it('rejects an implausible phone number', async () => {
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-badphone');

      const res = await request(http)
        .patch(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`)
        .send({ phone: 'call me maybe' });

      expect(res.status).toBe(400);
    });

    it('accepts a number written with spaces, brackets or a country code', async () => {
      // Permissive on purpose: a human dials this, and rejecting a legitimate
      // format means a customer who cannot finish signing up.
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-phoneformats');

      for (const phone of ['+91 98765 43210', '(022) 2345-6789', '9876543210']) {
        const res = await request(http)
          .patch(ctx.url('auth/customer/me'))
          .set('Authorization', `Bearer ${token}`)
          .send({ phone });
        expect(res.status).toBe(200);
      }
    });

    it('requires authentication', async () => {
      const res = await request(http).patch(ctx.url('auth/customer/me')).send({ name: 'Nobody' });
      expect(res.status).toBe(401);
    });

    it('cannot be used to change the email or the active flag', async () => {
      // forbidNonWhitelisted. Without it a stray field would be silently
      // dropped - or worse, applied.
      const { token } = await customerToken(ctx.app, ctx.prisma, prefix, '-noescalate');

      const res = await request(http)
        .patch(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X', email: 'attacker@example.test', isActive: true });

      expect(res.status).toBe(400);
    });
  });

  describe('refresh token handling', () => {
    /**
     * The refresh token lives in an httpOnly cookie rather than the response
     * body. It is long-lived, so one readable by JavaScript is one that a single
     * XSS turns into permanent account access; in a cookie the browser sends it
     * and script cannot read it.
     */
    it('sets the refresh token as an httpOnly cookie, not in the body', async () => {
      const customer = await createVerifiedCustomer(ctx.prisma, '-cookieflags');
      await plantOtp(ctx.prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

      const res = await request(http)
        .post(ctx.url('auth/customer/otp/verify'))
        .send({ email: customer.email, code: E2E_OTP });

      const raw = res.headers['set-cookie'];
      const header = (Array.isArray(raw) ? raw : [raw]).find((c: string) =>
        c.startsWith(REFRESH_COOKIE),
      ) as string;

      expect(header).toBeDefined();
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      // Scoped to the auth routes: it is useless elsewhere, and not sending it
      // on every product image request is both faster and a smaller surface.
      expect(header).toContain('Path=/api/v1/auth/customer');
      expect(res.body.data.refreshToken).toBeUndefined();
    });

    it('exchanges the cookie for a fresh access token', async () => {
      const { refreshCookie } = await customerToken(ctx.app, ctx.prisma, prefix, '-refresh');

      const res = await request(http)
        .post(ctx.url('auth/customer/refresh'))
        .set('Cookie', `${REFRESH_COOKIE}=${refreshCookie}`);

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));

      // The new access token must actually work.
      const me = await request(http)
        .get(ctx.url('auth/customer/me'))
        .set('Authorization', `Bearer ${res.body.data.accessToken}`);
      expect(me.status).toBe(200);
    });

    it('rotates the cookie, and refuses the old one afterwards', async () => {
      // Rotation is what makes a stolen refresh token a limited problem rather
      // than a permanent one: using it invalidates the copy the thief holds,
      // or theirs invalidates the customer's and the theft becomes visible.
      const { refreshCookie } = await customerToken(ctx.app, ctx.prisma, prefix, '-rotate');

      const first = await request(http)
        .post(ctx.url('auth/customer/refresh'))
        .set('Cookie', `${REFRESH_COOKIE}=${refreshCookie}`);
      expect(first.status).toBe(200);

      const rotated = cookieFrom(first, REFRESH_COOKIE);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(refreshCookie);

      const replay = await request(http)
        .post(ctx.url('auth/customer/refresh'))
        .set('Cookie', `${REFRESH_COOKIE}=${refreshCookie}`);
      expect(replay.status).toBe(401);
    });

    it('rejects a refresh with no cookie at all', async () => {
      const res = await request(http).post(ctx.url('auth/customer/refresh'));
      expect(res.status).toBe(401);
    });

    it('rejects a forged cookie', async () => {
      const res = await request(http)
        .post(ctx.url('auth/customer/refresh'))
        .set('Cookie', `${REFRESH_COOKIE}=not-a-real-token`);
      expect(res.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('clears the cookie and kills the refresh token', async () => {
      const { refreshCookie } = await customerToken(ctx.app, ctx.prisma, prefix, '-logout');

      const res = await request(http)
        .post(ctx.url('auth/customer/logout'))
        .set('Cookie', `${REFRESH_COOKIE}=${refreshCookie}`);
      expect(res.status).toBe(200);

      const afterwards = await request(http)
        .post(ctx.url('auth/customer/refresh'))
        .set('Cookie', `${REFRESH_COOKIE}=${refreshCookie}`);
      expect(afterwards.status).toBe(401);
    });

    it('succeeds even with no cookie, so a stale session can always be cleared', async () => {
      // The customer asked to be signed out. Failing because the token was
      // already invalid leaves them stuck in a broken state.
      const res = await request(http).post(ctx.url('auth/customer/logout'));
      expect(res.status).toBe(200);
    });
  });
});
