import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { UpdateRefundDto } from './dto/update-refund.dto';
import { QueryRefundsDto } from './dto/query-refunds.dto';

const ZERO = new Prisma.Decimal(0);

/**
 * A refund only means something once money has actually changed hands. On a COD
 * order nothing is paid until delivery, so refunding a PLACED order would be
 * recording the return of money never received.
 */
const REFUNDABLE_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.RETURNED,
  OrderStatus.REFUNDED,
  OrderStatus.CANCELLED,
];

const REFUND_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
      customer: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.RefundInclude;

@Injectable()
export class RefundsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryRefundsDto) {
    const { page = 1, limit = 20, search, status, orderId, fromDate, toDate } = query;

    const where: Prisma.RefundWhereInput = {
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { reason: { contains: search, mode: 'insensitive' } },
              { referenceNo: { contains: search, mode: 'insensitive' } },
              { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, completed, pending] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: REFUND_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.refund.count({ where }),
      this.prisma.refund.aggregate({
        where: { ...where, status: RefundStatus.COMPLETED },
        _sum: { amount: true },
      }),
      this.prisma.refund.aggregate({
        where: { ...where, status: RefundStatus.PENDING },
        _sum: { amount: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        completedAmount: completed._sum.amount ?? ZERO,
        // Money agreed but not yet sent - a real liability, and the figure worth
        // chasing on this screen.
        pendingAmount: pending._sum.amount ?? ZERO,
      },
    };
  }

  async findOne(id: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id }, include: REFUND_INCLUDE });
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  findForOrder(orderId: string) {
    return this.prisma.refund.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  async create(orderId: string, dto: CreateRefundDto, adminId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, totalAmount: true, refunds: { select: { amount: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (!REFUNDABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot refund an order with status ${order.status}. Payment is collected on delivery, so there is nothing to return yet.`,
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    this.assertWithinOrderTotal(order.totalAmount, order.refunds, amount);

    const status = dto.status ?? RefundStatus.PENDING;
    const refundedOn = dto.refundedOn
      ? new Date(dto.refundedOn)
      : status === RefundStatus.COMPLETED
        ? new Date()
        : null;

    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          orderId,
          amount,
          reason: dto.reason.trim(),
          method: dto.method,
          status,
          referenceNo: dto.referenceNo,
          refundedOn,
          notes: dto.notes,
          processedByAdminId: adminId,
        },
      });

      await this.syncOrderPaymentStatus(tx, orderId);
      return created;
    });

    return this.findOne(refund.id);
  }

  /**
   * Updates a refund - typically moving it from PENDING to COMPLETED once the
   * money has actually been sent.
   *
   * There is deliberately NO delete: refunds are financial records, and a
   * mistake is corrected with a FAILED status or a compensating entry, never by
   * removing history. Deleting them is how a ledger stops reconciling.
   */
  async update(id: string, dto: UpdateRefundDto) {
    const existing = await this.prisma.refund.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Refund not found');

    if (dto.amount !== undefined) {
      const order = await this.prisma.order.findUnique({
        where: { id: existing.orderId },
        select: {
          totalAmount: true,
          // This refund is excluded, so re-saving an unchanged amount cannot
          // fail against its own value.
          refunds: { where: { id: { not: id } }, select: { amount: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      this.assertWithinOrderTotal(order.totalAmount, order.refunds, new Prisma.Decimal(dto.amount));
    }

    const status = dto.status ?? existing.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id },
        data: {
          amount: dto.amount === undefined ? existing.amount : new Prisma.Decimal(dto.amount),
          reason: dto.reason?.trim() ?? existing.reason,
          method: dto.method ?? existing.method,
          status,
          referenceNo: dto.referenceNo === undefined ? existing.referenceNo : dto.referenceNo,
          // Stamped when it first becomes COMPLETED, so a completed refund
          // always carries the date the money went.
          refundedOn: dto.refundedOn
            ? new Date(dto.refundedOn)
            : status === RefundStatus.COMPLETED && !existing.refundedOn
              ? new Date()
              : existing.refundedOn,
          notes: dto.notes === undefined ? existing.notes : dto.notes,
        },
      });

      await this.syncOrderPaymentStatus(tx, existing.orderId);
    });

    return this.findOne(id);
  }

  /**
   * Over-refunding is refused outright: it would produce negative revenue in
   * every report downstream, and nothing else would flag it.
   */
  private assertWithinOrderTotal(
    orderTotal: Prisma.Decimal,
    otherRefunds: { amount: Prisma.Decimal }[],
    amount: Prisma.Decimal,
  ) {
    const alreadyRefunded = otherRefunds.reduce((acc, r) => acc.add(r.amount), ZERO);
    const remaining = orderTotal.sub(alreadyRefunded);

    if (amount.gt(remaining)) {
      throw new BadRequestException(
        `Refund of ${amount.toFixed(2)} exceeds the ${remaining.toFixed(2)} still refundable on this order (total ${orderTotal.toFixed(2)}, already refunded ${alreadyRefunded.toFixed(2)}).`,
      );
    }
  }

  /**
   * Keeps `Order.paymentStatus` in step with COMPLETED refunds.
   *
   * Only completed ones count: money merely agreed has not left the account, so
   * marking the order refunded would overstate what actually happened.
   */
  private async syncOrderPaymentStatus(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        totalAmount: true,
        paymentStatus: true,
        refunds: { where: { status: RefundStatus.COMPLETED }, select: { amount: true } },
      },
    });
    if (!order) return;

    const refunded = order.refunds.reduce((acc, r) => acc.add(r.amount), ZERO);
    const wasRefundStatus =
      order.paymentStatus === PaymentStatus.REFUNDED ||
      order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED;

    let paymentStatus: PaymentStatus;
    if (refunded.lte(0)) {
      // Nothing completed. Leave an unrelated status alone, but undo a refund
      // status if the completed refunds were moved back to PENDING or FAILED.
      paymentStatus = wasRefundStatus ? PaymentStatus.PAID : order.paymentStatus;
    } else if (refunded.gte(order.totalAmount)) {
      paymentStatus = PaymentStatus.REFUNDED;
    } else {
      paymentStatus = PaymentStatus.PARTIALLY_REFUNDED;
    }

    if (paymentStatus !== order.paymentStatus) {
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
    }
  }
}
