import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { QueryRawMaterialsDto } from './dto/query-raw-materials.dto';

const WITH_INGREDIENT = {
  ingredient: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.RawMaterialInclude;

@Injectable()
export class RawMaterialsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryRawMaterialsDto) {
    const { page = 1, limit = 20, search, isActive, lowStockOnly, ingredientId } = query;

    const where: Prisma.RawMaterialWhereInput = {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(ingredientId ? { ingredientId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.rawMaterial.findMany({
        where,
        include: WITH_INGREDIENT,
        orderBy: { name: 'asc' },
        // Low-stock is a comparison between two columns, which Prisma cannot
        // express in `where`, so it is applied after fetching. Paginating the
        // filtered set would need raw SQL; deferred until the volume justifies it.
        ...(lowStockOnly ? {} : { skip: (page - 1) * limit, take: limit }),
      }),
      this.prisma.rawMaterial.count({ where }),
    ]);

    if (lowStockOnly) {
      const low = items.filter(
        (item) => item.reorderLevel !== null && item.stockQuantity.lte(item.reorderLevel),
      );
      return { items: low, total: low.length, page: 1, limit: low.length, totalPages: 1 };
    }

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const material = await this.prisma.rawMaterial.findUnique({
      where: { id },
      include: WITH_INGREDIENT,
    });
    if (!material) throw new NotFoundException('Raw material not found');
    return material;
  }

  async create(dto: CreateRawMaterialDto) {
    if (dto.code) await this.assertCodeAvailable(dto.code);
    if (dto.ingredientId) await this.assertIngredientExists(dto.ingredientId);

    return this.prisma.rawMaterial.create({
      data: {
        name: dto.name,
        code: dto.code,
        baseUnit: dto.baseUnit,
        stockQuantity: dto.stockQuantity ?? 0,
        reorderLevel: dto.reorderLevel,
        avgCostPerUnit: dto.avgCostPerUnit,
        ingredientId: dto.ingredientId,
        notes: dto.notes,
        isActive: dto.isActive ?? true,
      },
      include: WITH_INGREDIENT,
    });
  }

  async update(id: string, dto: UpdateRawMaterialDto) {
    const existing = await this.findOne(id);

    if (dto.code && dto.code !== existing.code) await this.assertCodeAvailable(dto.code, id);
    if (dto.ingredientId) await this.assertIngredientExists(dto.ingredientId);

    // Changing the base unit would silently reinterpret the stock figure: 5000
    // recorded as GRAM is not 5000 KILOGRAM. Refuse while stock is non-zero
    // rather than corrupting the number.
    if (dto.baseUnit && dto.baseUnit !== existing.baseUnit && !existing.stockQuantity.isZero()) {
      throw new BadRequestException(
        `Cannot change the base unit while ${existing.stockQuantity.toString()} ${existing.baseUnit} is in stock. ` +
          `Adjust stock to zero first, or create a separate material.`,
      );
    }

    return this.prisma.rawMaterial.update({
      where: { id },
      data: dto,
      include: WITH_INGREDIENT,
    });
  }

  /** Materials are hard-deleted, so this refuses once purchase history exists. */
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.rawMaterial.delete({ where: { id } });
      return { message: 'Raw material deleted' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'Cannot delete this material because purchase bills or cost sheets reference it. Mark it inactive instead.',
        );
      }
      throw error;
    }
  }

  private async assertCodeAvailable(code: string, exceptId?: string) {
    const existing = await this.prisma.rawMaterial.findFirst({
      where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new ConflictException(`Code "${code}" is already used by "${existing.name}"`);
    }
  }

  private async assertIngredientExists(ingredientId: string) {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: ingredientId },
      select: { id: true },
    });
    if (!ingredient) throw new NotFoundException('Linked ingredient not found');
  }
}
