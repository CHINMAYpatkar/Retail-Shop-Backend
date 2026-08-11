import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';

@Injectable()
export class FaqsService {
  constructor(private prisma: PrismaService) {}

  findAllPublic() {
    return this.prisma.faqItem.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findAllAdmin() {
    return this.prisma.faqItem.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async findOneAdmin(id: string) {
    const faq = await this.prisma.faqItem.findUnique({ where: { id } });
    if (!faq) throw new NotFoundException('FAQ not found');
    return faq;
  }

  create(dto: CreateFaqDto) {
    return this.prisma.faqItem.create({ data: dto });
  }

  async update(id: string, dto: UpdateFaqDto) {
    await this.findOneAdmin(id);
    return this.prisma.faqItem.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOneAdmin(id);
    await this.prisma.faqItem.delete({ where: { id } });
    return { message: 'FAQ deleted' };
  }
}
