/**
 * Order fixtures for money-path specs.
 *
 * Built directly through Prisma rather than by driving the storefront checkout,
 * because the storefront does not exist yet and these specs are about what
 * happens to an order AFTER it is placed - refunds, status changes, reporting.
 * Checkout itself is covered separately.
 */
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { E2E_TAG } from './fixtures';

export interface OrderFixture {
  orderId: string;
  orderNumber: string;
  customerId: string;
  productId: string;
  total: string;
}

let counter = 0;
/** Unique but deterministic within a run - no Date.now(), which makes reruns unreproducible. */
function nextSuffix(): string {
  counter += 1;
  return String(counter).padStart(4, '0');
}

export async function createOrder(
  prisma: PrismaService,
  opts: {
    total: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    unitCostPrice?: string | null;
    quantity?: number;
  },
): Promise<OrderFixture> {
  const suffix = nextSuffix();
  const total = new Prisma.Decimal(opts.total);
  const quantity = opts.quantity ?? 1;

  const customer = await prisma.customer.create({
    data: {
      name: `E2E Customer ${suffix}`,
      email: `${E2E_TAG}cust-${suffix}@example.test`,
      emailVerifiedAt: new Date(0),
    },
  });

  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      line1: '1 Test Street',
      city: 'Pune',
      state: 'MH',
      postalCode: '411001',
      country: 'India',
      fullName: `E2E Customer ${suffix}`,
      phone: '9999999999',
    },
  });

  const category = await prisma.category.upsert({
    where: { slug: `${E2E_TAG}category` },
    update: {},
    create: { name: 'E2E Category', slug: `${E2E_TAG}category` },
  });

  const product = await prisma.product.create({
    data: {
      name: `E2E Product ${suffix}`,
      slug: `${E2E_TAG}product-${suffix}`,
      categoryId: category.id,
      price: total,
      stockQuantity: 100,
      weightGrams: 100,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: `${E2E_TAG}ORD-${suffix}`,
      customerId: customer.id,
      addressId: address.id,
      status: opts.status ?? OrderStatus.DELIVERED,
      paymentStatus: opts.paymentStatus ?? PaymentStatus.PAID,
      subtotal: total,
      totalAmount: total,
      items: {
        create: [
          {
            productId: product.id,
            productName: product.name,
            unitPrice: total.div(quantity),
            quantity,
            totalPrice: total,
            unitCostPrice:
              opts.unitCostPrice === null || opts.unitCostPrice === undefined
                ? null
                : new Prisma.Decimal(opts.unitCostPrice),
          },
        ],
      },
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: customer.id,
    productId: product.id,
    total: total.toFixed(2),
  };
}

/** Removes every row these fixtures create, in FK-safe order. */
export async function cleanupOrders(prisma: PrismaService): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: E2E_TAG } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  if (orderIds.length) {
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.product.deleteMany({ where: { slug: { startsWith: E2E_TAG } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: E2E_TAG } } });
  await prisma.address.deleteMany({
    where: { customer: { email: { startsWith: E2E_TAG } } },
  });
  await prisma.customer.deleteMany({ where: { email: { startsWith: E2E_TAG } } });
}

/**
 * Clears ALL transactional financial data in the test database.
 *
 * Reporting specs assert absolute figures ("revenue is exactly 1000"), which is
 * far more readable than before/after deltas but only works from a known-empty
 * baseline. The test database accumulated rows from earlier manual API testing,
 * so tag-scoped cleanup is not enough here.
 *
 * Safe only because `setup-e2e.ts` and `createTestApp` both refuse to run
 * against a database whose name does not end in `_test`. Never call this from
 * anything that could be pointed at the dev database.
 */
export async function resetFinancialData(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const name = rows[0]?.current_database;
  if (!name?.endsWith('_test')) {
    throw new Error(`resetFinancialData refused: database "${name}" is not a _test database.`);
  }

  await prisma.refund.deleteMany({});
  await prisma.orderStatusHistory.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.expense.deleteMany({});
}
