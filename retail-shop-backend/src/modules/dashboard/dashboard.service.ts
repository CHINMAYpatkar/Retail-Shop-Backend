import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getSummary() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      revenueAgg,
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
      this.prisma.order.aggregate({
        where: { createdAt: { gte: thirtyDaysAgo }, status: { notIn: ['CANCELLED'] } },
        _sum: { totalAmount: true },
        _count: true,
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

    return {
      revenueLast30Days: revenueAgg._sum.totalAmount || 0,
      ordersLast30Days: revenueAgg._count,
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
