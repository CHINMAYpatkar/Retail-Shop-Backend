import { Injectable, NotFoundException } from '@nestjs/common';
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
      await this.prisma.ingredient.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) } })
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

  async remove(id: string) {
    await this.findOneAdmin(id);
    await this.prisma.ingredient.delete({ where: { id } });
    return { message: 'Ingredient deleted' };
  }
}
