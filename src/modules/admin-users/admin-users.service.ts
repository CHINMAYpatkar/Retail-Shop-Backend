import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

const PASSWORD_SALT_ROUNDS = 12;

const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true } },
};

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.adminUser.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id }, select: SAFE_SELECT });
    console.log('findOne user:', user);
    if (!user) throw new NotFoundException('Admin user not found');
    return user;
  }

  async create(dto: CreateAdminUserDto) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An admin with this email already exists');

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);
    return this.prisma.adminUser.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        roleId: dto.roleId,
      },
      select: SAFE_SELECT,
    });
  }

  async update(id: string, dto: UpdateAdminUserDto) {
    await this.findOne(id);

    return this.prisma.adminUser.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        roleId: dto.roleId,
        isActive: dto.isActive,
        ...(dto.password
          ? { passwordHash: await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS) }
          : {}),
      },
      select: SAFE_SELECT,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.adminUser.delete({ where: { id } });
    return { message: 'Admin user deleted' };
  }
}
