import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsAdminDto } from './dto/query-products-admin.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

@ApiTags('Products (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/products')
export class ProductsAdminController {
  constructor(private service: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductsAdminDto) {
    return this.service.findAllAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/stock')
  @RequirePermissions('products.update')
  updateStock(@Param('id') id: string, @Body() dto: UpdateStockDto) {
    return this.service.updateStock(id, dto.stockQuantity);
  }

  @Patch(':id/restore')
  @RequirePermissions('products.update')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }

  @Delete(':id')
  @RequirePermissions('products.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
