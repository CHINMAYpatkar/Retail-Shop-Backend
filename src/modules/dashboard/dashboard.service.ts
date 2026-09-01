import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      deliveredAgg,
      bookedAgg,
      refundsAgg,
      pendingRefundsAgg,
      ordersByStatus,
      totalCustomers,
      totalProducts,
      lowStockProducts,
      latestOrders,
      topProducts,
      recentReviews,
      pendingReviewCount,
      openTicketCount,
    ] = await this.prisma.$transaction([
      // Money actually collected: payment is taken on delivery, so only a
      // DELIVERED order represents revenue. This deliberately matches the
      // reports P&L - the two figures previously disagreed, and two different
      // revenue numbers on two screens undermines trust in both.
      this.prisma.order.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo }, status: OrderStatus.DELIVERED },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Everything not cancelled, delivered or not. This is the pipeline, and
      // it is what the old "revenue" figure was actually measuring - kept, but
      // labelled honestly rather than passed off as revenue.
      this.prisma.order.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo }, status: { notIn: [OrderStatus.CANCELLED] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Only COMPLETED refunds reduce revenue; money merely agreed has not left.
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo }, status: RefundStatus.COMPLETED },
        _sum: { amount: true },
      }),
      // Reported separately as a liability, never netted off revenue.
      this.prisma.refund.aggregate({
        where: { status: RefundStatus.PENDING },
        _sum: { amount: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.customer.count(),
      this.prisma.product.count({ where: { deletedAt: null } }),
      this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true, stockQuantity: { lte: 10 } },
        orderBy: { stockQuantity: 'asc' },
        take: 10,
        select: { id: true, name: true, stockQuantity: true, sku: true },
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
        },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId', 'productName'],
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      this.prisma.review.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { product: { select: { name: true } }, customer: { select: { name: true } } },
      }),
      this.prisma.review.count({ where: { status: 'PENDING' } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);

    const grossRevenue = deliveredAgg._sum.totalAmount ?? ZERO;
    const refunds = refundsAgg._sum.amount ?? ZERO;

    return {
      /**
       * Net revenue over the window: delivered order value less completed
       * refunds. Same definition as `/admin/reports/profit-loss`.
       */
      revenueLast30Days: grossRevenue.sub(refunds).toDecimalPlaces(2),
      grossRevenueLast30Days: grossRevenue.toDecimalPlaces(2),
      refundsLast30Days: refunds.toDecimalPlaces(2),
      /** Delivered orders only - the count behind the revenue figure. */
      deliveredOrdersLast30Days: deliveredAgg._count,
      /** All non-cancelled orders: the pipeline, not money in hand. */
      bookedLast30Days: (bookedAgg._sum.totalAmount ?? ZERO).toDecimalPlaces(2),
      ordersLast30Days: bookedAgg._count,
      /** Agreed but not yet sent - a liability, not deducted above. */
      pendingRefundAmount: (pendingRefundsAgg._sum.amount ?? ZERO).toDecimalPlaces(2),
      ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count])),
      totalCustomers,
      totalProducts,
      lowStockProducts,
      latestOrders,
      topProducts,
      recentReviews,
      pendingReviewCount,
      openTicketCount,
    };
  }
}
