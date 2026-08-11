import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';
import { QueryReviewsAdminDto } from './dto/query-reviews-admin.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async createForCustomer(customerId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    const existing = await this.prisma.review.findFirst({
      where: { productId: dto.productId, customerId },
    });
    if (existing) throw new BadRequestException('You have already reviewed this product');

    // Verified purchase: the customer has a delivered order containing this product.
    const purchase = await this.prisma.orderItem.findFirst({
      where: { productId: dto.productId, order: { customerId, status: 'DELIVERED' } },
    });

    const { images, ...rest } = dto;
    return this.prisma.review.create({
      data: {
        ...rest,
        customerId,
        isVerifiedPurchase: !!purchase,
        status: 'PENDING',
        images: images ? { create: images.map((url) => ({ url })) } : undefined,
      },
      include: { images: true },
    });
  }

  findAllForCustomer(customerId: string) {
    return this.prisma.review.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { images: true, product: { select: { id: true, name: true, slug: true } } },
    });
  }

  async findAllForProduct(productId: string, query: QueryReviewsDto) {
    const { page = 1, limit = 10, sort } = query;
    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      sort === 'highest'
        ? { rating: 'desc' }
        : sort === 'lowest'
          ? { rating: 'asc' }
          : { createdAt: 'desc' };

    const where: Prisma.ReviewWhereInput = { productId, status: 'APPROVED' };
    const [items, total, ratingAgg] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { images: true, customer: { select: { name: true } } },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({ where, _avg: { rating: true }, _count: { rating: true } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      ratingAverage: ratingAgg._avg.rating || 0,
      ratingCount: ratingAgg._count.rating,
    };
  }

  // ---------- Admin ----------

  async findAllAdmin(query: QueryReviewsAdminDto) {
    const { page = 1, limit = 20, status, search } = query;
    const where: Prisma.ReviewWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { comment: { contains: search, mode: 'insensitive' } },
              { product: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: true,
          customer: { select: { id: true, name: true, email: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async findOneAdminOrThrow(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  async updateStatus(id: string, status: 'PENDING' | 'APPROVED' | 'REJECTED') {
    await this.findOneAdminOrThrow(id);
    return this.prisma.review.update({ where: { id }, data: { status } });
  }

  async reply(id: string, reply: string) {
    await this.findOneAdminOrThrow(id);
    return this.prisma.review.update({ where: { id }, data: { adminReply: reply } });
  }

  async remove(id: string) {
    await this.findOneAdminOrThrow(id);
    await this.prisma.review.delete({ where: { id } });
    return { message: 'Review deleted' };
  }
}
