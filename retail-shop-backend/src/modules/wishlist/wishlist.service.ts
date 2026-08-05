import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private prisma: PrismaService) {}

  findAll(customerId: string) {
    return this.prisma.wishlistItem.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        },
      },
    });
  }

  async add(customerId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.wishlistItem.findUnique({
      where: { customerId_productId: { customerId, productId } },
    });
    if (existing) throw new ConflictException('Product is already in your wishlist');

    return this.prisma.wishlistItem.create({ data: { customerId, productId } });
  }

  async remove(customerId: string, productId: string) {
    await this.prisma.wishlistItem.deleteMany({ where: { customerId, productId } });
    return { message: 'Removed from wishlist' };
  }
}
