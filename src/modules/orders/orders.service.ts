import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { generateOrderNumber } from '../../common/utils/order-number';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersAdminDto } from './dto/query-orders-admin.dto';

// Only these forward transitions are allowed; anything else is rejected with a
// clear message rather than silently corrupting order state.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
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
} satisfies Prisma.OrderInclude;

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
    return this.prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const orderItemsData: Prisma.OrderItemCreateManyOrderInput[] = [];

      for (const item of cartItems) {
        if (!item.product.isActive || item.product.deletedAt) {
          throw new BadRequestException(`"${item.product.name}" is no longer available`);
        }

        let unitPrice = Number(item.product.price);
        if (item.variantId) {
          const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
          if (!variant) throw new BadRequestException('A selected product option is no longer available');
          if (variant.stockQuantity < item.quantity) {
            throw new BadRequestException(`Not enough stock for "${item.product.name}" (${variant.name})`);
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

        const totalPrice = unitPrice * item.quantity;
        subtotal += totalPrice;
        orderItemsData.push({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.product.name,
          unitPrice,
          quantity: item.quantity,
          totalPrice,
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
    }).then(async (order) => {
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
      throw new BadRequestException(`Orders in "${order.status}" status can no longer be cancelled`);
    }
    return this.transitionStatus(order.id, 'CANCELLED', reason || 'Cancelled by customer', 'customer');
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

  async updateStatus(id: string, status: OrderStatus, note?: string, changedBy?: string) {
    const order = await this.findOneAdmin(id);
    return this.transitionStatus(order.id, status, note, changedBy, order.status);
  }

  private async transitionStatus(
    orderId: string,
    nextStatus: OrderStatus,
    note?: string,
    changedBy?: string,
    currentStatus?: OrderStatus,
  ) {
    const order = currentStatus
      ? { status: currentStatus }
      : await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot move an order from "${order.status}" to "${nextStatus}". Allowed next steps: ${
          allowed.length ? allowed.join(', ') : 'none (final state)'
        }`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        ...(nextStatus === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: note } : {}),
        statusHistory: { create: { status: nextStatus, note, changedBy } },
      },
      include: { ...ORDER_INCLUDE, customer: { select: { email: true } } },
    });

    // Restock on cancellation so inventory stays accurate.
    if (nextStatus === 'CANCELLED') {
      for (const item of updated.items) {
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
      await this.mail.sendOrderStatusEmail(updated.customer.email, updated.orderNumber, nextStatus);
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
