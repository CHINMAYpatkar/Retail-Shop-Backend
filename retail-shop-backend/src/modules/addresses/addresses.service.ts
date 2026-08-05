import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(private prisma: PrismaService) {}

  findAllForCustomer(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async assertOwnership(id: string, customerId: string) {
    const address = await this.prisma.address.findUnique({ where: { id } });
    if (!address) throw new NotFoundException('Address not found');
    if (address.customerId !== customerId) throw new ForbiddenException('Not your address');
    return address;
  }

  async create(customerId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }

    return this.prisma.address.create({
      data: {
        customerId,
        label: dto.label ?? '',
        fullName: dto.fullName ?? '',
        phone: dto.phone ?? '',
        line1: dto.line1 ?? '',
        line2: dto.line2 ?? '',
        city: dto.city ?? '',
        state: dto.state ?? '',
        postalCode: dto.postalCode ?? '',
        country: dto.country ?? '',
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async update(id: string, customerId: string, dto: UpdateAddressDto) {
    await this.assertOwnership(id, customerId);
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.address.update({ where: { id }, data: dto });
  }

  async remove(id: string, customerId: string) {
    await this.assertOwnership(id, customerId);
    await this.prisma.address.delete({ where: { id } });
    return { message: 'Address deleted' };
  }
}
