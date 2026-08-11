import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  // ---------- Public (storefront) ----------

  findAllPublic() {
    return this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOnePublicBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      include: { children: { where: { isActive: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  // ---------- Admin ----------

  findAllAdmin() {
    return this.prisma.category.findMany({
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findOneAdmin(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { parent: true, children: true, _count: { select: { products: true } } },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base);
    let attempt = 0;
    // Loop rather than a single check to gracefully handle repeated collisions.
    while (
      await this.prisma.category.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      })
    ) {
      attempt += 1;
      slug = `${slugify(base)}-${attempt + 1}`;
    }
    return slug;
  }

  async create(dto: CreateCategoryDto) {
    const slug = await this.ensureUniqueSlug(dto.slug || dto.name);
    return this.prisma.category.create({ data: { ...dto, slug } });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOneAdmin(id);
    const data: any = { ...dto };
    if (dto.slug || dto.name) {
      data.slug = await this.ensureUniqueSlug(dto.slug || dto.name!, id);
    }
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOneAdmin(id);

    const nonDeletedProductCount = await this.prisma.product.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (nonDeletedProductCount > 0) {
      throw new ConflictException(
        'Cannot delete a category that still has products. Move or delete those products first.',
      );
    }
    await this.prisma.category.delete({ where: { id } });
    return { message: 'Category deleted' };
  }
}
