/**
 * Fixtures for end-to-end specs.
 *
 * Every created row is tagged with an `e2e-` marker in its email or slug so
 * `cleanup()` can remove exactly what a spec made and nothing else. Specs share
 * one database and run with `maxWorkers: 1`, but they must still not depend on
 * each other's leftovers.
 */
import { INestApplication } from '@nestjs/common';
import { AdminRoleName } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';

export const E2E_PASSWORD = 'E2ePass@123';
export const E2E_TAG = 'e2e-';

/** Cost 4 rather than the production 12: same bcrypt, ~250x less time per user. */
const TEST_BCRYPT_ROUNDS = 4;

export interface SeededAdmin {
  id: string;
  email: string;
  role: AdminRoleName;
}

/**
 * Creates (or reuses) an admin user with the given role.
 *
 * Roles and their permission grants come from `prisma/seed.ts`, which must have
 * been run against the test database first - the roles are reference data, not
 * something a spec should invent, or the spec would be asserting against
 * permissions it granted itself.
 */
export async function createAdmin(
  prisma: PrismaService,
  role: AdminRoleName,
  suffix = '',
): Promise<SeededAdmin> {
  const email = `${E2E_TAG}${role.toLowerCase()}${suffix}@example.test`;
  const roleRow = await prisma.role.findUnique({ where: { name: role } });

  if (!roleRow) {
    throw new Error(
      `Role ${role} is missing from the test database. Run "npm run test:e2e:seed" first.`,
    );
  }

  const passwordHash = await bcrypt.hash(E2E_PASSWORD, TEST_BCRYPT_ROUNDS);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash, isActive: true, roleId: roleRow.id },
    create: { name: `E2E ${role}`, email, passwordHash, roleId: roleRow.id },
  });

  return { id: admin.id, email: admin.email, role };
}

/** Logs in through the real HTTP endpoint, so token issuance is covered too. */
export async function loginAdmin(
  app: INestApplication,
  prefix: string,
  email: string,
  password = E2E_PASSWORD,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/${prefix}/auth/admin/login`)
    .send({ email, password });

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const token = res.body?.data?.accessToken ?? res.body?.accessToken;
  if (!token) {
    throw new Error(`Login for ${email} returned no accessToken: ${JSON.stringify(res.body)}`);
  }
  return token;
}

/** Convenience: create the user and return a usable bearer token. */
export async function adminToken(
  app: INestApplication,
  prisma: PrismaService,
  prefix: string,
  role: AdminRoleName,
  suffix = '',
): Promise<{ token: string; admin: SeededAdmin }> {
  const admin = await createAdmin(prisma, role, suffix);
  const token = await loginAdmin(app, prefix, admin.email);
  return { token, admin };
}

/** Removes only rows this suite created. */
export async function cleanupAdmins(prisma: PrismaService): Promise<void> {
  const admins = await prisma.adminUser.findMany({
    where: { email: { startsWith: E2E_TAG } },
    select: { id: true },
  });
  const ids = admins.map((a) => a.id);
  if (ids.length === 0) return;

  await prisma.activityLog.deleteMany({ where: { adminUserId: { in: ids } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: ids } } });
}
