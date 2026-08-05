import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RecipesService } from './recipes.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';

@ApiTags('Recipes (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/recipes')
export class RecipesAdminController {
  constructor(private service: RecipesService) {}

  @Get()
  findAll() {
    return this.service.findAllAdmin();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post()
  @RequirePermissions('recipes.create')
  create(@Body() dto: CreateRecipeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('recipes.update')
  update(@Param('id') id: string, @Body() dto: UpdateRecipeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recipes.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
