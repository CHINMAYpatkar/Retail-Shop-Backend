/**
 * The authorization matrix, asserted end to end for every role.
 *
 * Two distinct mechanisms are in play and conflating them is what caused the
 * MANAGER lockout:
 *
 *  - `@Roles(...)` is coarse. It asks which ROLE you hold.
 *  - `@RequirePermissions(...)` is fine. It asks whether your role was GRANTED
 *    a specific permission key in `prisma/seed.ts`.
 *
 * A route needs both to be right. A route with roles but no permission check is
 * open to every listed role regardless of what they were granted - which is
 * exactly the class of gap this spec exists to catch.
 *
 * The commercial rule being enforced: supplier pricing, product cost and margin
 * are SUPER_ADMIN/ADMIN information. MANAGER runs operations (catalogue,
 * orders, customers). STAFF views orders and support tickets and nothing else.
 */
import { AdminRoleName } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';

const ALL_ROLES = [
  AdminRoleName.SUPER_ADMIN,
  AdminRoleName.ADMIN,
  AdminRoleName.MANAGER,
  AdminRoleName.STAFF,
] as const;

type Role = (typeof ALL_ROLES)[number];

/** Roles cleared for the back office: supplier pricing, costs, margins, money. */
const BACK_OFFICE: Role[] = [AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN];
/** Roles cleared to administer the system itself. */
const SYSTEM: Role[] = [AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN];

interface RouteCase {
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  allowed: readonly Role[];
  /** Body for write methods, so a 400 does not masquerade as a 200. */
  body?: Record<string, unknown>;
}

const ROUTES: RouteCase[] = [
  // --- Operations: MANAGER's remit, STAFF read-only where granted ------------
  { name: 'list products', method: 'get', path: 'admin/products', allowed: ALL_ROLES },
  { name: 'list categories', method: 'get', path: 'admin/categories', allowed: ALL_ROLES },
  { name: 'list orders', method: 'get', path: 'admin/orders', allowed: ALL_ROLES },
  { name: 'list customers', method: 'get', path: 'admin/customers', allowed: ALL_ROLES },
  {
    name: 'list support tickets',
    method: 'get',
    path: 'admin/support/tickets',
    allowed: ALL_ROLES,
  },

  // --- Dashboard: operations need it, STAFF was never granted it -------------
  {
    name: 'dashboard summary',
    method: 'get',
    path: 'admin/dashboard/summary',
    allowed: [AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER],
  },

  // --- Back office: supplier pricing, cost, margin, money --------------------
  { name: 'list vendors', method: 'get', path: 'admin/vendors', allowed: BACK_OFFICE },
  { name: 'list raw materials', method: 'get', path: 'admin/raw-materials', allowed: BACK_OFFICE },
  {
    name: 'list purchase bills',
    method: 'get',
    path: 'admin/purchase-bills',
    allowed: BACK_OFFICE,
  },
  {
    name: 'list vendor payments',
    method: 'get',
    path: 'admin/vendor-payments',
    allowed: BACK_OFFICE,
  },
  { name: 'list expenses', method: 'get', path: 'admin/expenses', allowed: BACK_OFFICE },
  { name: 'list refunds', method: 'get', path: 'admin/refunds', allowed: BACK_OFFICE },
  {
    name: 'profit and loss',
    method: 'get',
    path: 'admin/reports/profit-loss',
    allowed: BACK_OFFICE,
  },
  {
    name: 'vendor payables',
    method: 'get',
    path: 'admin/reports/vendor-payables',
    allowed: BACK_OFFICE,
  },
  {
    name: 'stock valuation',
    method: 'get',
    path: 'admin/reports/stock-valuation',
    allowed: BACK_OFFICE,
  },

  // --- System administration -------------------------------------------------
  { name: 'list admin users', method: 'get', path: 'admin/users', allowed: SYSTEM },
  { name: 'list roles', method: 'get', path: 'admin/roles', allowed: SYSTEM },
  { name: 'list permissions', method: 'get', path: 'admin/permissions', allowed: SYSTEM },
  { name: 'read settings', method: 'get', path: 'admin/settings', allowed: SYSTEM },
];

describe('RBAC matrix (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    for (const role of ALL_ROLES) {
      const { token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', role, '-rbac');
      tokens[role] = token;
    }
  });

  afterAll(async () => {
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  describe.each(ROUTES)('$method $path ($name)', (route) => {
    it.each(ALL_ROLES)('%s', async (role) => {
      const req = request(http)
        [route.method](ctx.url(route.path))
        .set('Authorization', `Bearer ${tokens[role]}`);
      const res = route.body ? await req.send(route.body) : await req;

      if (route.allowed.includes(role)) {
        // 404/400 are fine - they mean the guard let us through and the handler
        // ran. Only 401/403 would mean authorization refused us.
        expect([401, 403]).not.toContain(res.status);
      } else {
        expect(res.status).toBe(403);
      }
    });
  });
});

/**
 * The media library, which the matrix above cannot express.
 *
 * `admin/media` lists every role in `@Roles` and has no `PermissionsGuard`, so
 * the granted permission keys are never consulted. That makes DELETE reachable
 * by STAFF - a role whose entire grant is `orders.view` and `support.view`.
 *
 * The delete is a hard delete of the row AND the bytes on disk, and MediaAsset
 * is the attachment target for purchase bills, vendor payments and expenses.
 * So the reachable consequence is a STAFF account destroying the scan of a
 * financial record, with `onDelete: SetNull` quietly clearing the reference.
 */
describe('Media library authorization (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    for (const role of ALL_ROLES) {
      const { token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', role, '-media');
      tokens[role] = token;
    }
  });

  afterAll(async () => {
    await ctx.prisma.mediaAsset.deleteMany({ where: { fileName: { startsWith: 'e2e-' } } });
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  /** An externally-linked asset: no storageKey, so nothing on disk to clean up. */
  async function makeAsset(label: string) {
    return ctx.prisma.mediaAsset.create({
      data: {
        fileName: `e2e-${label}.jpg`,
        type: 'IMAGE',
        folder: 'products',
        url: `https://example.test/${label}.jpg`,
      },
    });
  }

  it('lets SUPER_ADMIN and ADMIN delete a media asset', async () => {
    for (const role of [AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN] as Role[]) {
      const asset = await makeAsset(`allowed-${role}`);
      const res = await request(http)
        .delete(ctx.url(`admin/media/${asset.id}`))
        .set('Authorization', `Bearer ${tokens[role]}`);
      expect(res.status).toBeLessThan(300);
    }
  });

  it.each([AdminRoleName.MANAGER, AdminRoleName.STAFF])(
    'refuses %s permission to delete a media asset',
    async (role) => {
      const asset = await makeAsset(`denied-${role}`);
      const res = await request(http)
        .delete(ctx.url(`admin/media/${asset.id}`))
        .set('Authorization', `Bearer ${tokens[role as Role]}`);

      expect(res.status).toBe(403);

      const stillThere = await ctx.prisma.mediaAsset.findUnique({ where: { id: asset.id } });
      expect(stillThere).not.toBeNull();
    },
  );

  it('refuses STAFF permission to add a media asset', async () => {
    const res = await request(http)
      .post(ctx.url('admin/media'))
      .set('Authorization', `Bearer ${tokens[AdminRoleName.STAFF]}`)
      .send({ fileName: 'e2e-staff-create.jpg', type: 'IMAGE', url: 'https://example.test/x.jpg' });

    expect(res.status).toBe(403);
  });

  it('still lets MANAGER browse the library, which product editing needs', async () => {
    const res = await request(http)
      .get(ctx.url('admin/media'))
      .set('Authorization', `Bearer ${tokens[AdminRoleName.MANAGER]}`);
    expect(res.status).toBe(200);
  });
});
