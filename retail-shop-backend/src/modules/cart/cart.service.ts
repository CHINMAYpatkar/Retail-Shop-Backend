import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  private async withTotals(customerId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
      },
    });

    let subtotal = 0;
    const enriched = await Promise.all(
      items.map(async (item) => {
        let unitPrice = Number(item.product.price);
        if (item.variantId) {
          const variant = await this.prisma.productVariant.findUnique({ where: { id: item.variantId } });
          if (variant?.priceOverride) unitPrice = Number(variant.priceOverride);
        }
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;
        return { ...item, unitPrice, lineTotal };
      }),
    );

    return { items: enriched, subtotal, itemCount: enriched.reduce((n, i) => n + i.quantity, 0) };
  }

  getCart(customerId: string) {
    return this.withTotals(customerId);
  }

  async addItem(customerId: string, dto: AddCartItemDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || !product.isActive || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: dto.variantId } });
      if (!variant || variant.productId !== dto.productId) {
        throw new BadRequestException('Invalid variant for this product');
      }
    }

    const quantity = dto.quantity ?? 1;
    const existing = await this.prisma.cartItem.findUnique({
      where: {
        customerId_productId_variantId: {
          customerId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
        } as any,
      },
    }).catch(() => null);

    if (existing) {
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    }

    return this.prisma.cartItem.create({
      data: { customerId, productId: dto.productId, variantId: dto.variantId, quantity },
    });
  }

  async updateItem(customerId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Cart item not found');
    if (item.customerId !== customerId) throw new ForbiddenException('Not your cart item');

    return this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
  }

  async removeItem(customerId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Cart item not found');
    if (item.customerId !== customerId) throw new ForbiddenException('Not your cart item');

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return { message: 'Item removed from cart' };
  }

  async clear(customerId: string) {
    await this.prisma.cartItem.deleteMany({ where: { customerId } });
    return { message: 'Cart cleared' };
  }
}
