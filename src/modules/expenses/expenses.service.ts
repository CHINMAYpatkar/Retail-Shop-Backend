import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

const EXPENSE_INCLUDE = {
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryExpensesDto) {
    const { page = 1, limit = 20, search, category, method, vendorId, fromDate, toDate } = query;

    const where: Prisma.ExpenseWhereInput = {
      ...(category ? { category } : {}),
      ...(method ? { method } : {}),
      ...(vendorId ? { vendorId } : {}),
      ...(fromDate || toDate
        ? {
            spentOn: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { vendor: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total, aggregate, byCategory] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      // Totals cover the whole filtered set, not just this page - a page total
      // would be meaningless for a spend figure.
      summary: {
        totalAmount: aggregate._sum.amount ?? ZERO,
        byCategory: byCategory.map((row) => ({
          category: row.category,
          amount: row._sum?.amount ?? ZERO,
        })),
      },
    };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async create(dto: CreateExpenseDto, adminId?: string) {
    if (dto.vendorId) await this.assertVendorExists(dto.vendorId);

    return this.prisma.expense.create({
      data: {
        category: dto.category,
        title: dto.title.trim(),
        amount: new Prisma.Decimal(dto.amount),
        spentOn: new Date(dto.spentOn),
        method: dto.method,
        vendorId: dto.vendorId,
        attachmentMediaId: dto.attachmentMediaId,
        notes: dto.notes,
        createdByAdminId: adminId,
      },
      include: EXPENSE_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.findOne(id);
    if (dto.vendorId) await this.assertVendorExists(dto.vendorId);

    return this.prisma.expense.update({
      where: { id },
      data: {
        category: dto.category ?? existing.category,
        title: dto.title?.trim() ?? existing.title,
        amount: dto.amount === undefined ? existing.amount : new Prisma.Decimal(dto.amount),
        spentOn: dto.spentOn ? new Date(dto.spentOn) : existing.spentOn,
        method: dto.method ?? existing.method,
        vendorId: dto.vendorId === undefined ? existing.vendorId : dto.vendorId,
        attachmentMediaId:
          dto.attachmentMediaId === undefined ? existing.attachmentMediaId : dto.attachmentMediaId,
        notes: dto.notes === undefined ? existing.notes : dto.notes,
      },
      include: EXPENSE_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.expense.delete({ where: { id } });
    return { message: 'Expense deleted' };
  }

  private async assertVendorExists(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
  }
}
