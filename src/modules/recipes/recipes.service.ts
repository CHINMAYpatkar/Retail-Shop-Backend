import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  findAllPublic() {
    return this.prisma.recipe.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        products: { include: { product: { select: { id: true, name: true, slug: true } } } },
      },
    });
  }

  async findOnePublicBySlug(slug: string) {
    const recipe = await this.prisma.recipe.findFirst({
      where: { slug, isActive: true },
      include: {
        ingredients: { include: { ingredient: true } },
        products: {
          include: { product: { select: { id: true, name: true, slug: true, price: true } } },
        },
      },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  findAllAdmin() {
    return this.prisma.recipe.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async findOneAdmin(id: string) {
    const recipe = await this.prisma.recipe.findUnique({
      where: { id },
      include: {
        ingredients: { include: { ingredient: true } },
        products: { include: { product: true } },
      },
    });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base);
    let attempt = 0;
    while (
      await this.prisma.recipe.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      })
    ) {
      attempt += 1;
      slug = `${slugify(base)}-${attempt + 1}`;
    }
    return slug;
  }

  async create(dto: CreateRecipeDto) {
    const slug = await this.ensureUniqueSlug(dto.slug || dto.name);
    const { ingredients, productIds, ...rest } = dto;

    return this.prisma.recipe.create({
      data: {
        ...rest,
        slug,
        steps: rest.steps as any,
        ingredients: ingredients
          ? {
              create: ingredients.map((i) => ({
                ingredientId: i.ingredientId,
                quantity: i.quantity,
              })),
            }
          : undefined,
        products: productIds
          ? { create: productIds.map((productId) => ({ productId })) }
          : undefined,
      },
      include: { ingredients: true, products: true },
    });
  }

  async update(id: string, dto: UpdateRecipeDto) {
    await this.findOneAdmin(id);
    const { ingredients, productIds, ...rest } = dto;
    const data: any = { ...rest };
    if (rest.steps) data.steps = rest.steps as any;
    if (dto.slug || dto.name) data.slug = await this.ensureUniqueSlug(dto.slug || dto.name!, id);

    return this.prisma.$transaction(async (tx) => {
      if (ingredients) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
        await tx.recipeIngredient.createMany({
          data: ingredients.map((i) => ({
            recipeId: id,
            ingredientId: i.ingredientId,
            quantity: i.quantity,
          })),
        });
      }
      if (productIds) {
        await tx.recipeProduct.deleteMany({ where: { recipeId: id } });
        await tx.recipeProduct.createMany({
          data: productIds.map((productId) => ({ recipeId: id, productId })),
        });
      }
      return tx.recipe.update({
        where: { id },
        data,
        include: { ingredients: true, products: true },
      });
    });
  }

  /**
   * Deleting a recipe is permanent - there is no soft delete here and no trash
   * view, so a misclick loses real authoring effort with nothing to restore.
   *
   * Rather than add soft delete, this follows the pattern already documented
   * for this project: for content that is expensive to recreate, the cheapest
   * protection is `isActive: false`. So an ACTIVE recipe cannot be deleted at
   * all - deactivate it first, which hides it from the storefront immediately
   * and is trivially reversible.
   *
   * That turns an irreversible one-click mistake into a reversible two-step
   * one, without a migration.
   */
  async remove(id: string) {
    const recipe = await this.findOneAdmin(id);

    if (recipe.isActive) {
      throw new BadRequestException(
        'Deactivate this recipe before deleting it. Deactivating hides it from the storefront straight away and can be undone; deleting cannot.',
      );
    }

    await this.prisma.recipe.delete({ where: { id } });
    return { message: 'Recipe deleted' };
  }
}
