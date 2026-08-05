import { Injectable, NotFoundException } from '@nestjs/common';
import { BannerPlacement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(private prisma: PrismaService) {}

  findAllPublic(placement?: BannerPlacement) {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        isActive: true,
        ...(placement ? { placement } : {}),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findAllAdmin() {
    return this.prisma.banner.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }] });
  }

  async findOneAdmin(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }

  create(dto: CreateBannerDto) {
    return this.prisma.banner.create({ data: dto as any });
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.findOneAdmin(id);
    return this.prisma.banner.update({ where: { id }, data: dto as any });
  }

  async remove(id: string) {
    await this.findOneAdmin(id);
    await this.prisma.banner.delete({ where: { id } });
    return { message: 'Banner deleted' };
  }
}
