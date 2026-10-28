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

  /**
   * The `as any` these two used to carry was simply unnecessary - checked by
   * removing it, and the DTOs type-check against Prisma's input as they are.
   * Prisma accepts an ISO-8601 string for a DateTime column, so `startsAt` and
   * `endsAt` need no conversion either.
   *
   * Worth recording because a cast that is not load-bearing is worse than one
   * that is: it silences every future mismatch in the same statement, and the
   * next person has no way to tell it was decorative.
   */
  create(dto: CreateBannerDto) {
    return this.prisma.banner.create({ data: dto });
  }

  async update(id: string, dto: UpdateBannerDto) {
    await this.findOneAdmin(id);
    return this.prisma.banner.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOneAdmin(id);
    await this.prisma.banner.delete({ where: { id } });
    return { message: 'Banner deleted' };
  }
}
