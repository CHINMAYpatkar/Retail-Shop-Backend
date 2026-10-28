import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../../common/utils/slugify';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';

@Injectable()
export class BlogsService {
  constructor(private prisma: PrismaService) {}

  async findAllPublic(query: PaginationQueryDto) {
    const { page = 1, limit = 10 } = query;
    const where = { isPublished: true };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.blog.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.blog.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOnePublicBySlug(slug: string) {
    const blog = await this.prisma.blog.findFirst({ where: { slug, isPublished: true } });
    if (!blog) throw new NotFoundException('Blog post not found');
    return blog;
  }

  findAllAdmin() {
    return this.prisma.blog.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOneAdmin(id: string) {
    const blog = await this.prisma.blog.findUnique({ where: { id } });
    if (!blog) throw new NotFoundException('Blog post not found');
    return blog;
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = slugify(base);
    let attempt = 0;
    while (
      await this.prisma.blog.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      })
    ) {
      attempt += 1;
      slug = `${slugify(base)}-${attempt + 1}`;
    }
    return slug;
  }

  async create(dto: CreateBlogDto) {
    const slug = await this.ensureUniqueSlug(dto.slug || dto.title);
    return this.prisma.blog.create({
      data: { ...dto, slug, publishedAt: dto.isPublished ? new Date() : null },
    });
  }

  async update(id: string, dto: UpdateBlogDto) {
    const existing = await this.findOneAdmin(id);
    const data: any = { ...dto };
    if (dto.slug || dto.title) data.slug = await this.ensureUniqueSlug(dto.slug || dto.title!, id);
    if (dto.isPublished && !existing.publishedAt) data.publishedAt = new Date();
    return this.prisma.blog.update({ where: { id }, data });
  }

  /**
   * Same reasoning as recipes: deleting is permanent and a post is real
   * authoring effort, so a PUBLISHED post cannot be deleted outright.
   *
   * Unpublish first - which takes it off the storefront immediately and is
   * reversible - then delete if you still mean to. `isPublished` is this
   * model's equivalent of the `isActive` flag the pattern calls for.
   */
  async remove(id: string) {
    const blog = await this.findOneAdmin(id);

    if (blog.isPublished) {
      throw new BadRequestException(
        'Unpublish this post before deleting it. Unpublishing removes it from the storefront straight away and can be undone; deleting cannot.',
      );
    }

    await this.prisma.blog.delete({ where: { id } });
    return { message: 'Blog post deleted' };
  }
}
