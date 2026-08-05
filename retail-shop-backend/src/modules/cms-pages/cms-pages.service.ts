import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertCmsPageDto } from './dto/upsert-cms-page.dto';

@Injectable()
export class CmsPagesService {
  constructor(private prisma: PrismaService) {}

  async findOnePublic(slug: string) {
    const page = await this.prisma.cmsPage.findFirst({ where: { slug, isPublished: true } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  findAllAdmin() {
    return this.prisma.cmsPage.findMany({ orderBy: { slug: 'asc' } });
  }

  async findOneAdmin(slug: string) {
    const page = await this.prisma.cmsPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  upsert(dto: UpsertCmsPageDto) {
    const { slug, ...data } = dto;
    return this.prisma.cmsPage.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
    });
  }

  async remove(slug: string) {
    await this.findOneAdmin(slug);
    await this.prisma.cmsPage.delete({ where: { slug } });
    return { message: 'Page deleted' };
  }
}
