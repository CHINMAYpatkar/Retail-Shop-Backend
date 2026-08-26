import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { QueryProductsAdminDto } from './dto/query-products-admin.dto';

const PUBLIC_CARD_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  price: true,
  compareAtPrice: true,
  isFeatured: true,
  stockQuantity: true,
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
} satisfies Prisma.ProductSelect;

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // ---------- Public (storefront) ----------

  async findAllPublic(query: QueryProductsDto) {
    const { page = 1, limit = 20, search, category, minPrice, maxPrice, sort, featured } = query;

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      deletedAt: null,
      ...(category ? { category: { slug: category } } : {}),
      ...(featured !== undefined ? { isFeatured: featured } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { shortDescription: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            price: {
              ...(minPrice !== undefined ? { gte: minPrice } : {}),
              ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
            },
          }
        : {}),
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sort === 'price_asc'
        ? { price: 'asc' }
        : sort === 'price_desc'
          ? { price: 'desc' }
          : sort === 'name_asc'
            ? { name: 'asc' }
            : { createdAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: PUBLIC_CARD_SELECT,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOnePublicBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { where: { isActive: true } },
        ingredients: { include: { ingredient: true } },
        recipes: { include: { recipe: true } },
        reviews: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { images: true, customer: { select: { name: true } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const ratingAgg = await this.prisma.review.aggregate({
      where: { productId: product.id, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      ...product,
      ratingAverage: ratingAgg._avg.rating || 0,
      ratingCount: ratingAgg._count.rating,
    };
  }

  // ---------- Admin ----------

  async findAllAdmin(query: QueryProductsAdminDto) {
    const { page = 1, limit = 20, search, categoryId, isActive, includeDeleted, onlyDeleted } = query;

    const where: Prisma.ProductWhereInput = {
      // Three states, not two: the trash view needs ONLY deleted rows, so that
      // restoring something removes it from that view. `includeDeleted` mixes
      // both, which made a restored product appear to still be deleted.
      ...(onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null }),
      ...(categoryId ? { categoryId } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          _count: { select: { orderItems: true, reviews: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneAdmin(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        variants: true,
        ingredients: { include: { ingredient: true } },
        recipes: { include: { recipe: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base);
    let attempt = 0;
    while (
      await this.prisma.product.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      })
    ) {
      attempt += 1;
      slug = `${slugify(base)}-${attempt + 1}`;
    }
    return slug;
  }

  async create(dto: CreateProductDto) {
    const slug = await this.ensureUniqueSlug(dto.slug || dto.name);
    const { ingredientIds, images, variants, ...rest } = dto;

    return this.prisma.product.create({
      data: {
        ...rest,
        slug,
        images: images ? { create: images } : undefined,
        variants: variants ? { create: variants } : undefined,
        ingredients: ingredientIds
          ? { create: ingredientIds.map((ingredientId) => ({ ingredientId })) }
          : undefined,
      },
      include: { images: true, variants: true, ingredients: true, category: true },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOneAdmin(id);
    const { ingredientIds, images, variants, ...rest } = dto;
    const data: any = { ...rest };
    if (dto.slug || dto.name) data.slug = await this.ensureUniqueSlug(dto.slug || dto.name!, id);

    // Replace-strategy for nested collections: simplest way to keep client & DB in sync.
    return this.prisma.$transaction(async (tx) => {
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: images.map((img) => ({ ...img, productId: id })),
        });
      }
      if (variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        await tx.productVariant.createMany({
          data: variants.map((v) => ({ ...v, productId: id })),
        });
      }
      if (ingredientIds) {
        await tx.productIngredient.deleteMany({ where: { productId: id } });
        await tx.productIngredient.createMany({
          data: ingredientIds.map((ingredientId) => ({ productId: id, ingredientId })),
        });
      }

      return tx.product.update({
        where: { id },
        data,
        include: { images: true, variants: true, ingredients: true, category: true },
      });
    });
  }

  async updateStock(id: string, stockQuantity: number) {
    await this.findOneAdmin(id);
    return this.prisma.product.update({ where: { id }, data: { stockQuantity } });
  }

  /** Soft delete: keeps order history intact while hiding the product from the storefront. */
  async remove(id: string) {
    await this.findOneAdmin(id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Product deleted (soft delete)' };
  }

  async restore(id: string) {
    const product = await this.findOneAdmin(id);
    if (!product.categoryId) {
      throw new ConflictException(
        'Cannot restore this product because its category has been deleted. Assign it to a category first.',
      );
    }
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }
}
