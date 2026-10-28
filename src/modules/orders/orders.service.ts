import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderItemStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { generateOrderNumber } from '../../common/utils/order-number';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersAdminDto } from './dto/query-orders-admin.dto';
import { SetItemAvailabilityDto } from './dto/set-item-availability.dto';
import {
  blocksAdvanceTo,
  collectionAmount,
  derivePaymentStatus,
  deriveOrderStatus,
  isFrozen,
  isFulfilmentDerived,
  linesShippingNow,
} from './order-fulfilment';

// Only these forward transitions are allowed; anything else is rejected with a
// clear message rather than silently corrupting order state.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],

  // A held order can be packed or shipped once its stock arrives - clearing
  // the hold derives it back to a moving status - and can still be cancelled,
  // which is often what the customer asks for when the date is too far out.
  AWAITING_STOCK: ['PACKED', 'CANCELLED'],

  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],

  // A partially shipped order has two things going on at once, so all three
  // are reachable: the second parcel going out (SHIPPED), either parcel being
  // on a van (OUT_FOR_DELIVERY), and the parcel that is out arriving
  // (DELIVERED). The last one does NOT finish the order - it lands those lines
  // and the derivation puts the order straight back to PARTIALLY_SHIPPED,
  // because something is still owed.
  PARTIALLY_SHIPPED: ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'],

  OUT_FOR_DELIVERY: ['DELIVERED', 'PARTIALLY_SHIPPED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: ['REFUNDED'],
  REFUNDED: [],
};

const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PLACED', 'CONFIRMED', 'PROCESSING'];

const ORDER_INCLUDE = {
  items: { include: { product: { select: { id: true, name: true, slug: true } } } },
  address: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  payments: { orderBy: { collectedAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

/**
 * What to collect, if anything, for the lines landing in this transition.
 *
 * Null when nothing is being delivered, or when the order is not cash on
 * delivery - an online-paid order has already settled and must never be
 * collected against twice.
 */
function buildCollection(
  order: {
    paymentMethod: string;
    totalAmount: Prisma.Decimal;
    items: { totalPrice: Prisma.Decimal }[];
    payments: { amount: Prisma.Decimal }[];
  },
  deliveringNow: { totalPrice: Prisma.Decimal }[],
  changedBy?: string,
) {
  if (deliveringNow.length === 0 || order.paymentMethod !== 'COD') return null;

  const alreadyCollected = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const isFirst = order.payments.length === 0;
  const total = Number(order.totalAmount);

  // The order-level charges are the gap between the total and the sum of the
  // lines - shipping and tax, less any discount. Derived from the total rather
  // than re-added from the component fields, so this figure can never disagree
  // with the amount the customer was actually shown.
  const allLines = order.items.reduce((sum, i) => sum + Number(i.totalPrice), 0);
  const orderLevelCharges = isFirst ? total - allLines : 0;

  const lineTotals = deliveringNow.map((i) => Number(i.totalPrice));
  const amount = collectionAmount(lineTotals, orderLevelCharges, isFirst);

  // Never collect past the total. A rounding crumb must not become an
  // over-collection that someone has to explain at the end of the day.
  const capped = Math.max(0, Math.min(amount, total - alreadyCollected));

  return {
    payment: {
      amount: new Prisma.Decimal(capped.toFixed(2)),
      note:
        isFirst && deliveringNow.length < order.items.length
          ? 'First parcel, including delivery charges'
          : undefined,
      recordedBy: changedBy ?? 'system',
    },
    paymentStatus: derivePaymentStatus(alreadyCollected + capped, total),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  // ---------- Customer ----------

  async checkout(customerId: string, dto: CreateOrderDto) {
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.customerId !== customerId) {
      throw new BadRequestException('Invalid delivery address');
    }

    const cartItems = await this.prisma.cartItem.findMany({
      where: { customerId },
      include: { product: true },
    });
    if (cartItems.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    // Snapshot pricing/stock at checkout time inside a transaction so nothing
    // moves between the check and the deduction.
    return this.prisma
      .$transaction(async (tx) => {
        let subtotal = 0;
        const orderItemsData: Prisma.OrderItemCreateManyOrderInput[] = [];

        for (const item of cartItems) {
          if (!item.product.isActive || item.product.deletedAt) {
            throw new BadRequestException(`"${item.product.name}" is no longer available`);
          }

          let unitPrice = Number(item.product.price);
          if (item.variantId) {
            const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
            if (!variant)
              throw new BadRequestException('A selected product option is no longer available');
            if (variant.stockQuantity < item.quantity) {
              throw new BadRequestException(
                `Not enough stock for "${item.product.name}" (${variant.name})`,
              );
            }
            if (variant.priceOverride) unitPrice = Number(variant.priceOverride);
            await tx.productVariant.update({
              where: { id: variant.id },
              data: { stockQuantity: { decrement: item.quantity } },
            });
          } else {
            if (item.product.stockQuantity < item.quantity) {
              throw new BadRequestException(`Not enough stock for "${item.product.name}"`);
            }
            await tx.product.update({
              where: { id: item.product.id },
              data: { stockQuantity: { decrement: item.quantity } },
            });
          }

          // What this unit costs US, frozen here alongside what the customer
          // paid. Stored rather than looked up later so COGS is exact and
          // immutable: a future cost-sheet revision can never rewrite the margin
          // on a sale that already happened, and reports need no as-of-date join.
          //
          // Null when the product has no active cost sheet - the margin is then
          // genuinely unknown for this sale, which is better recorded as unknown
          // than guessed at from today's costs.
          const activeCostSheet = await tx.productCostSheet.findFirst({
            where: { productId: item.productId, isActive: true },
            select: { costPerUnit: true },
          });

          const totalPrice = unitPrice * item.quantity;
          subtotal += totalPrice;
          orderItemsData.push({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.product.name,
            unitPrice,
            quantity: item.quantity,
            totalPrice,
            unitCostPrice: activeCostSheet?.costPerUnit ?? null,
          });
        }

        const shippingAmount = 0; // flat/free for now - future-ready field for shipping rules
        const taxAmount = 0; // future-ready field for tax rules
        const totalAmount = subtotal + shippingAmount + taxAmount;

        let orderNumber = generateOrderNumber();
        // Extremely unlikely, but guard against the rare random collision.
        // eslint-disable-next-line no-constant-condition
        while (await tx.order.findUnique({ where: { orderNumber } })) {
          orderNumber = generateOrderNumber();
        }

        const order = await tx.order.create({
          data: {
            orderNumber,
            customerId,
            addressId: dto.addressId,
            paymentMethod: dto.paymentMethod ?? 'COD',
            subtotal,
            taxAmount,
            shippingAmount,
            totalAmount,
            items: { createMany: { data: orderItemsData } },
            statusHistory: { create: { status: 'PLACED', note: 'Order placed by customer' } },
          },
          include: ORDER_INCLUDE,
        });

        await tx.cartItem.deleteMany({ where: { customerId } });

        return order;
      })
      .then(async (order) => {
        const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
        if (customer) {
          await this.mail.sendOrderStatusEmail(customer.email, order.orderNumber, 'Placed');
        }
        return order;
      });
  }

  findAllForCustomer(customerId: string) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: ORDER_INCLUDE,
    });
  }

  async findOneForCustomer(customerId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) throw new ForbiddenException('Not your order');
    return order;
  }

  async cancelByCustomer(customerId: string, id: string, reason?: string) {
    const order = await this.findOneForCustomer(customerId, id);
    if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
      throw new BadRequestException(
        `Orders in "${order.status}" status can no longer be cancelled`,
      );
    }
    return this.transitionStatus(
      order.id,
      'CANCELLED',
      reason || 'Cancelled by customer',
      'customer',
    );
  }

  // ---------- Admin ----------

  async findAllAdmin(query: QueryOrdersAdminDto) {
    const { page = 1, limit = 20, search, status } = query;
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: 'insensitive' } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneAdmin(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { ...ORDER_INCLUDE, customer: { select: { id: true, name: true, email: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Mark one line of an order out of stock, or available again.
   *
   * Deliberately does NOT touch stock. The unit was decremented at checkout and
   * is still owed to this customer; incrementing it back would offer the same
   * jar to somebody else while this order still has a claim on it - a double
   * sale, discovered at the second customer's doorstep.
   *
   * "Unavailable" means "I cannot ship this yet", not "this order no longer
   * wants it". Those look alike and are not.
   */
  async setItemAvailability(
    orderId: string,
    itemId: string,
    dto: SetItemAvailabilityDto,
    changedBy?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: { select: { email: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('That item is not on this order');

    if (isFrozen(order.status)) {
      throw new BadRequestException(
        `This order is ${order.status.toLowerCase()} - its items can no longer be rescheduled.`,
      );
    }

    // Once a line is physically out, availability is no longer a question
    // about it. Saying otherwise would put a date on a jar already in a van.
    if (item.fulfilmentStatus === 'SHIPPED' || item.fulfilmentStatus === 'DELIVERED') {
      throw new BadRequestException(
        `"${item.productName}" has already been dispatched and cannot be marked unavailable.`,
      );
    }

    if (!dto.available && dto.expectedAvailabilityDate) {
      const expected = new Date(dto.expectedAvailabilityDate);
      if (expected.getTime() <= Date.now()) {
        throw new BadRequestException(
          'The expected availability date must be in the future - a date already past tells the customer nothing.',
        );
      }
    }

    const nextLineStatus: OrderItemStatus = dto.available ? 'PENDING' : 'AWAITING_STOCK';

    const projected = order.items.map((i) =>
      i.id === itemId ? { ...i, fulfilmentStatus: nextLineStatus } : i,
    );
    const stillHeld = projected.some((i) => i.fulfilmentStatus === 'AWAITING_STOCK');

    // Clearing the last hold clears the order's hold flag too. Leaving it set
    // would silently block the NEXT backorder from being split.
    const holdForStock = dto.available
      ? stillHeld
        ? order.holdForStock
        : false
      : (dto.holdForStock ?? false);

    // AWAITING_STOCK and PARTIALLY_SHIPPED are not positions in the lifecycle -
    // they describe a disagreement between lines. When that ends, the order has
    // to return to where it actually was, which only the history knows. Reading
    // it back beats storing a "previous status" that can go stale.
    const intended = isFulfilmentDerived(order.status)
      ? await this.lastLifecycleStatus(orderId)
      : order.status;

    const resolved = deriveOrderStatus(intended, projected, holdForStock);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          fulfilmentStatus: nextLineStatus,
          expectedAvailabilityDate: dto.available
            ? null
            : new Date(dto.expectedAvailabilityDate as string),
          availabilityNote: dto.available ? null : (dto.availabilityNote ?? null),
        },
      });

      return tx.order.update({
        where: { id: orderId },
        data: {
          holdForStock,
          status: resolved,
          ...(resolved === order.status
            ? {}
            : {
                statusHistory: {
                  create: {
                    status: resolved,
                    note: dto.available
                      ? `"${item.productName}" is back in stock`
                      : `"${item.productName}" is out of stock until ${new Date(
                          dto.expectedAvailabilityDate as string,
                        ).toDateString()}`,
                    changedBy,
                  },
                },
              }),
        },
        include: { ...ORDER_INCLUDE, customer: { select: { id: true, name: true, email: true } } },
      });
    });

    // Tell the customer. This is the entire point of the feature - an order
    // silently sitting still is indistinguishable from an order forgotten.
    if (order.customer?.email) {
      if (dto.available) {
        await this.mail.sendItemBackInStockEmail(
          order.customer.email,
          updated.orderNumber,
          item.productName,
        );
      } else {
        await this.mail.sendItemUnavailableEmail(order.customer.email, {
          orderNumber: updated.orderNumber,
          productName: item.productName,
          expectedDate: new Date(dto.expectedAvailabilityDate as string),
          note: dto.availabilityNote,
          holdingWholeOrder: holdForStock,
        });
      }
    }

    return updated;
  }

  /**
   * The last status this order held that was a real step, not a fulfilment
   * description.
   *
   * Falls back to PROCESSING only when the history has nothing else - an order
   * that reached a hold must have been confirmed and worked on to get there,
   * so that is the least wrong answer available.
   */
  private async lastLifecycleStatus(orderId: string): Promise<OrderStatus> {
    const history = await this.prisma.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return history.find((h) => !isFulfilmentDerived(h.status))?.status ?? 'PROCESSING';
  }

  async updateStatus(id: string, status: OrderStatus, note?: string, changedBy?: string) {
    const order = await this.findOneAdmin(id);
    return this.transitionStatus(order.id, status, note, changedBy);
  }

  private async transitionStatus(
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
    changedBy?: string,
  ) {
    // Always read the lines, not just the status. What the order BECOMES now
    // depends on them, and a status set without consulting them is exactly the
    // drift this mechanism exists to prevent.
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, payments: true },
    });

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot move an order from "${order.status}" to "${nextStatus}". Allowed next steps: ${
          allowed.length ? allowed.join(', ') : 'none (final state)'
        }`,
      );
    }

    const held = order.items.filter((i) => i.fulfilmentStatus === 'AWAITING_STOCK');

    // A HELD order cannot be packed or shipped - that is what holding means.
    // A split order can, and its held lines travel in the second parcel.
    if (held.length > 0 && order.holdForStock && blocksAdvanceTo(nextStatus)) {
      const names = held.map((i) => i.productName).join(', ');
      throw new BadRequestException(
        `This order is on hold until every item is in stock. Still waiting on: ${names}. ` +
          'Mark them available, or switch the order to ship what is ready.',
      );
    }

    // Move the lines this transition actually moves, then let the order's
    // status follow from them.
    const shippingNow = nextStatus === 'SHIPPED' ? linesShippingNow(order.items) : [];
    const deliveringNow =
      nextStatus === 'DELIVERED' ? order.items.filter((i) => i.fulfilmentStatus === 'SHIPPED') : [];

    const lineUpdates: Record<string, OrderItemStatus> = {};
    for (const item of shippingNow) lineUpdates[item.id] = 'SHIPPED';
    for (const item of deliveringNow) lineUpdates[item.id] = 'DELIVERED';

    const projected = order.items.map((item) => ({
      ...item,
      fulfilmentStatus: lineUpdates[item.id] ?? item.fulfilmentStatus,
    }));

    // CANCELLED and the return states describe the ORDER, not its fulfilment,
    // so they are set outright with nothing to derive.
    const resolved =
      nextStatus === 'CANCELLED' || nextStatus === 'RETURNED' || nextStatus === 'REFUNDED'
        ? nextStatus
        : deriveOrderStatus(nextStatus, projected, order.holdForStock);

    const collection = buildCollection(order, deliveringNow, changedBy);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const [itemId, fulfilmentStatus] of Object.entries(lineUpdates)) {
        await tx.orderItem.update({ where: { id: itemId }, data: { fulfilmentStatus } });
      }

      if (collection) {
        await tx.orderPayment.create({ data: { orderId, ...collection.payment } });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: resolved,
          ...(collection ? { paymentStatus: collection.paymentStatus } : {}),
          ...(nextStatus === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: note } : {}),
          statusHistory: {
            create: {
              status: resolved,
              // When the order lands somewhere other than what was asked for,
              // say so. A history entry reading PARTIALLY_SHIPPED after someone
              // pressed "Shipped" looks like a bug unless it explains itself.
              note:
                resolved === nextStatus
                  ? note
                  : `${note ?? `Marked ${nextStatus}`} - part of the order is still to follow`,
              changedBy,
            },
          },
        },
        include: { ...ORDER_INCLUDE, customer: { select: { email: true } } },
      });
    });

    // Restock on cancellation so inventory stays accurate. Lines already out
    // are skipped: cancellation is unreachable once a parcel has shipped, but
    // restocking a delivered jar would invent stock sitting in someone's
    // kitchen.
    if (nextStatus === 'CANCELLED') {
      for (const item of updated.items) {
        if (item.fulfilmentStatus === 'SHIPPED' || item.fulfilmentStatus === 'DELIVERED') continue;
        if (item.variantId) {
          await this.prisma.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { increment: item.quantity } },
          });
        } else {
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } },
          });
        }
      }
    }

    if (updated.customer?.email) {
      await this.mail.sendOrderStatusEmail(updated.customer.email, updated.orderNumber, resolved);
    }

    return updated;
  }

  /** Lightweight invoice data - a PDF renderer can consume this shape later. */
  async getInvoiceData(id: string) {
    const order = await this.findOneAdmin(id);
    return {
      orderNumber: order.orderNumber,
      issuedAt: order.createdAt,
      customer: order.customer,
      address: order.address,
      items: order.items,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      shippingAmount: order.shippingAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    };
  }
}
