import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class IngredientsService {
  constructor(private prisma: PrismaService) {}

  findAllPublic() {
    return this.prisma.ingredient.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }

  async findOnePublicBySlug(slug: string) {
    const ingredient = await this.prisma.ingredient.findFirst({ where: { slug, isActive: true } });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
    return ingredient;
  }

  findAllAdmin() {
    return this.prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
  }

  async findOneAdmin(id: string) {
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
    return ingredient;
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base);
    let attempt = 0;
    while (
      await this.prisma.ingredient.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      })
    ) {
      attempt += 1;
      slug = `${slugify(base)}-${attempt + 1}`;
    }
    return slug;
  }

  async create(dto: CreateIngredientDto) {
    const slug = await this.ensureUniqueSlug(dto.slug || dto.name);
    return this.prisma.ingredient.create({ data: { ...dto, slug } });
  }

  async update(id: string, dto: UpdateIngredientDto) {
    await this.findOneAdmin(id);
    const data: any = { ...dto };
    if (dto.slug || dto.name) data.slug = await this.ensureUniqueSlug(dto.slug || dto.name!, id);
    return this.prisma.ingredient.update({ where: { id }, data });
  }

  /**
   * Refuses to delete an ingredient that is still in use.
   *
   * `ProductIngredient` and `RecipeIngredient` both cascade on delete, so
   * without this guard removing an ingredient would silently strip it from
   * every product and recipe referencing it. Ingredients are hard-deleted
   * (only Product is soft-deleted, see ADR 0002), so there is no undo -
   * prevention is the only protection available.
   */
  async remove(id: string) {
    await this.findOneAdmin(id);

    const [productCount, recipeCount] = await this.prisma.$transaction([
      this.prisma.productIngredient.count({ where: { ingredientId: id } }),
      this.prisma.recipeIngredient.count({ where: { ingredientId: id } }),
    ]);

    if (productCount > 0 || recipeCount > 0) {
      const used = [
        productCount > 0 ? `${productCount} product(s)` : null,
        recipeCount > 0 ? `${recipeCount} recipe(s)` : null,
      ]
        .filter(Boolean)
        .join(' and ');

      throw new ConflictException(
        `Cannot delete this ingredient because it is used by ${used}. ` +
          `Remove it from those first, or mark the ingredient inactive to hide it from the storefront.`,
      );
    }

    await this.prisma.ingredient.delete({ where: { id } });
    return { message: 'Ingredient deleted' };
  }
}
