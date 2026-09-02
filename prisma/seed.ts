import { PrismaClient, AdminRoleName } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// One permission key per module x action. Extend as new modules are added.
const MODULES = [
  'products',
  'categories',
  'ingredients',
  'recipes',
  'orders',
  'customers',
  'reviews',
  'banners',
  'cms',
  'blogs',
  'faqs',
  'media',
  'support',
  'settings',
  'users', // admin users
  'roles',
  'dashboard',
  // Back-office / procurement. Restricted to SUPER_ADMIN and ADMIN below:
  // supplier pricing and product margins are not STAFF or MANAGER information.
  'vendors',
  'raw-materials',
  'purchase-bills',
  'vendor-payments',
  'costing',
  'expenses',
  'refunds',
  'reports',
];
const ACTIONS = ['view', 'create', 'update', 'delete'];

async function main() {
  console.log('Seeding permissions...');
  const permissionKeys: string[] = [];
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const key = `${module}.${action}`;
      permissionKeys.push(key);
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, module, description: `${action} ${module}` },
      });
    }
  }

  console.log('Seeding roles...');
  const allPermissions = await prisma.permission.findMany();

  const superAdminRole = await prisma.role.upsert({
    where: { name: AdminRoleName.SUPER_ADMIN },
    update: {},
    create: { name: AdminRoleName.SUPER_ADMIN, description: 'Full system access' },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: superAdminRole.id } });
  await prisma.rolePermission.createMany({
    data: allPermissions.map((p) => ({ roleId: superAdminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const adminRole = await prisma.role.upsert({
    where: { name: AdminRoleName.ADMIN },
    update: {},
    create: { name: AdminRoleName.ADMIN, description: 'Store administrator' },
  });
  const adminPerms = allPermissions.filter((p) => p.module !== 'roles' && p.module !== 'users');
  await prisma.rolePermission.deleteMany({ where: { roleId: adminRole.id } });
  await prisma.rolePermission.createMany({
    data: adminPerms.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const managerRole = await prisma.role.upsert({
    where: { name: AdminRoleName.MANAGER },
    update: {},
    create: {
      name: AdminRoleName.MANAGER,
      description: 'Operations manager (orders, products, customers)',
    },
  });
  // Whole modules MANAGER owns outright.
  const managerModules = [
    'products',
    'categories',
    'ingredients',
    'recipes',
    'orders',
    'customers',
    'reviews',
    'dashboard',
  ];
  // Individual keys rather than the whole module. MANAGER edits the catalogue,
  // so browsing and adding media is part of the job - but deleting a media
  // asset is not, because MediaAsset is also the attachment target for purchase
  // bills, vendor payments and expenses, and the delete removes the bytes.
  const managerExtraKeys = ['media.view', 'media.create', 'media.update'];

  const managerPerms = allPermissions.filter(
    (p) => managerModules.includes(p.module) || managerExtraKeys.includes(p.key),
  );
  await prisma.rolePermission.deleteMany({ where: { roleId: managerRole.id } });
  await prisma.rolePermission.createMany({
    data: managerPerms.map((p) => ({ roleId: managerRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const staffRole = await prisma.role.upsert({
    where: { name: AdminRoleName.STAFF },
    update: {},
    create: { name: AdminRoleName.STAFF, description: 'Limited support/fulfilment access' },
  });
  const staffPerms = allPermissions.filter(
    (p) => (p.module === 'orders' || p.module === 'support') && p.key.endsWith('.view'),
  );
  await prisma.rolePermission.deleteMany({ where: { roleId: staffRole.id } });
  await prisma.rolePermission.createMany({
    data: staffPerms.map((p) => ({ roleId: staffRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  console.log('Seeding default super admin user...');
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@retailshop.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Super Admin',
      email,
      passwordHash,
      roleId: superAdminRole.id,
    },
  });

  console.log('---------------------------------------------');
  console.log('Seed complete.');
  console.log(`Super admin login -> email: ${email} | password: ${password}`);
  console.log('CHANGE THIS PASSWORD IMMEDIATELY after first login.');
  console.log('---------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
