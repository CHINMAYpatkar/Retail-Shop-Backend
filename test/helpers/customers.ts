/**
 * Customer fixtures for storefront-side specs.
 *
 * Tokens are obtained by driving the REAL login endpoint rather than by calling
 * `TokensService` directly. That costs a planted OTP row and buys coverage of
 * the path the storefront will actually use: verify consumes the code, issues a
 * pair, and stamps `lastLoginAt`.
 *
 * OTP codes are bcrypt-hashed in the database and cannot be read back, so the
 * fixture writes a row whose hash it already knows. This is the same shape the
 * service would have written - it does not bypass `verifyOtp`, only the email.
 */
import { INestApplication } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { E2E_TAG } from './fixtures';

/** Cost 4 rather than production's: same bcrypt, far less time per fixture. */
const TEST_BCRYPT_ROUNDS = 4;

export const E2E_OTP = '123456';

export interface SeededCustomer {
  id: string;
  email: string;
}

/** A customer whose email is already confirmed, so they can request a login code. */
export async function createVerifiedCustomer(
  prisma: PrismaService,
  suffix = '',
): Promise<SeededCustomer> {
  const email = `${E2E_TAG}customer${suffix}@example.test`;

  const customer = await prisma.customer.upsert({
    where: { email },
    update: { emailVerifiedAt: new Date(0), isActive: true },
    create: {
      email,
      name: `E2E Customer${suffix}`,
      emailVerifiedAt: new Date(0),
    },
  });

  return { id: customer.id, email: customer.email };
}

/**
 * Writes an OTP row the way `OtpService.issueOtp` would, with a code we know.
 *
 * Clears any earlier unconsumed code for the same address and purpose first:
 * `verifyOtp` looks for the most recent live code, and leaving stale rows
 * behind makes a spec's outcome depend on what ran before it.
 */
export async function plantOtp(
  prisma: PrismaService,
  email: string,
  purpose: OtpPurpose,
  code: string = E2E_OTP,
  customerId?: string,
): Promise<void> {
  await prisma.otpCode.deleteMany({ where: { email, purpose } });

  await prisma.otpCode.create({
    data: {
      email,
      purpose,
      customerId,
      codeHash: await bcrypt.hash(code, TEST_BCRYPT_ROUNDS),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
}

/** Pulls a cookie value out of a supertest response's Set-Cookie header. */
export function cookieFrom(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = all.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return null;
  return match.split(';')[0].slice(name.length + 1);
}

export const REFRESH_COOKIE = 'rs_customer_refresh';

/**
 * Creates a verified customer and signs them in through the real endpoint.
 *
 * The refresh token is no longer in the response body - it is set as an
 * httpOnly cookie - so it is read back off `Set-Cookie` here, which is also the
 * only way a browser would ever get at it.
 */
export async function customerToken(
  app: INestApplication,
  prisma: PrismaService,
  prefix: string,
  suffix = '',
): Promise<{
  token: string;
  refreshCookie: string | null;
  customer: SeededCustomer;
  body: Record<string, unknown>;
}> {
  const customer = await createVerifiedCustomer(prisma, suffix);
  await plantOtp(prisma, customer.email, OtpPurpose.LOGIN, E2E_OTP, customer.id);

  const res = await request(app.getHttpServer())
    .post(`/${prefix}/auth/customer/otp/verify`)
    .send({ email: customer.email, code: E2E_OTP });

  const token = res.body?.data?.accessToken;
  if (!token) {
    throw new Error(
      `Customer sign-in failed for ${customer.email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return {
    token,
    refreshCookie: cookieFrom(res, REFRESH_COOKIE),
    customer,
    body: res.body.data,
  };
}

/** A brand-new, unverified email with a REGISTER code waiting - the sign-up branch. */
export async function newCustomerOtp(
  prisma: PrismaService,
  suffix = '',
): Promise<{ email: string }> {
  const email = `${E2E_TAG}newcustomer${suffix}@example.test`;

  await prisma.customer.deleteMany({ where: { email } });
  const customer = await prisma.customer.create({ data: { email } });
  await plantOtp(prisma, email, OtpPurpose.REGISTER, E2E_OTP, customer.id);

  return { email };
}

/** Removes only the rows these fixtures create. */
export async function cleanupCustomers(prisma: PrismaService): Promise<void> {
  const customers = await prisma.customer.findMany({
    where: { email: { startsWith: E2E_TAG } },
    select: { id: true, email: true },
  });
  if (customers.length === 0) return;

  const ids = customers.map((c) => c.id);
  const emails = customers.map((c) => c.email);

  await prisma.otpCode.deleteMany({ where: { email: { in: emails } } });
  await prisma.cartItem.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
}
