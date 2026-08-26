import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RawMaterialsService } from './raw-materials.service';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { QueryRawMaterialsDto } from './dto/query-raw-materials.dto';

/** SUPER_ADMIN/ADMIN only - purchase costs are commercially sensitive. */
@ApiTags('Raw Materials (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/raw-materials')
export class RawMaterialsController {
  constructor(private service: RawMaterialsService) {}

  @Get()
  @RequirePermissions('raw-materials.view')
  findAll(@Query() query: QueryRawMaterialsDto) {
    return this.service.findAll(query);
  }

  // Declared before ':id' so it can never be captured as an id.
  @Get('low-stock')
  @RequirePermissions('raw-materials.view')
  lowStock() {
    return this.service.findAll({ lowStockOnly: true });
  }

  @Get(':id')
  @RequirePermissions('raw-materials.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('raw-materials.create')
  create(@Body() dto: CreateRawMaterialDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('raw-materials.update')
  update(@Param('id') id: string, @Body() dto: UpdateRawMaterialDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('raw-materials.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
