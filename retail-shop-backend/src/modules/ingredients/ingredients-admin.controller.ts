import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { IngredientsService } from './ingredients.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@ApiTags('Ingredients (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/ingredients')
export class IngredientsAdminController {
  constructor(private service: IngredientsService) {}

  @Get()
  findAll() {
    return this.service.findAllAdmin();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @RequirePermissions('ingredients.create')
  create(@Body() dto: CreateIngredientDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('ingredients.update')
  update(@Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('ingredients.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
