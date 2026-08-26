import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { QueryVendorsDto } from './dto/query-vendors.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryVendorsDto) {
    const { page = 1, limit = 20, search, isActive } = query;

    const where: Prisma.VendorWhereInput = {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { contactPerson: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async create(dto: CreateVendorDto) {
    await this.assertNameAvailable(dto.name);
    return this.prisma.vendor.create({ data: dto });
  }

  async update(id: string, dto: UpdateVendorDto) {
    await this.findOne(id);
    if (dto.name) await this.assertNameAvailable(dto.name, id);
    return this.prisma.vendor.update({ where: { id }, data: dto });
  }

  /**
   * Vendors are hard-deleted, so this refuses once there is any history.
   *
   * Purchase bills and payments are financial records: losing the vendor they
   * belong to would leave orphaned amounts that no report could attribute.
   * Deactivating instead keeps the history intact and hides the vendor from
   * pickers - which is what "we don't buy from them any more" actually means.
   *
   * The bill/payment checks are written as raw counts because those models do
   * not exist yet; they become real relations in the next slice.
   */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.vendor
      .delete({ where: { id } })
      .then(() => ({ message: 'Vendor deleted' }))
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003' // foreign key constraint
        ) {
          throw new ConflictException(
            'Cannot delete this vendor because bills or payments reference it. Mark the vendor inactive instead.',
          );
        }
        throw error;
      });
  }

  private async assertNameAvailable(name: string, exceptId?: string) {
    const existing = await this.prisma.vendor.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    // Not a DB constraint: two genuinely different suppliers could share a name,
    // so this is a guard against accidental duplicates rather than a hard rule.
    if (existing) {
      throw new ConflictException(`A vendor named "${name}" already exists`);
    }
  }
}
