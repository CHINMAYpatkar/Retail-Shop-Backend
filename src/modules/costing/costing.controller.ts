import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CostingService } from './costing.service';
import { CreateCostSheetDto } from './dto/create-cost-sheet.dto';
import { UpdateCostSheetDto } from './dto/update-cost-sheet.dto';

/** SUPER_ADMIN/ADMIN only - product margins are the most sensitive figure here. */
@ApiTags('Costing (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin')
export class CostingController {
  constructor(private service: CostingService) {}

  // Declared before the parameterised routes so 'margins' is never read as an id.
  @Get('costing/margins')
  @RequirePermissions('costing.view')
  @ApiOperation({
    summary: 'Price vs cost for every product',
    description:
      'Products without an active cost sheet are listed separately rather than omitted - not knowing a margin is itself worth seeing.',
  })
  margins() {
    return this.service.margins();
  }

  @Get('products/:productId/cost-sheets')
  @RequirePermissions('costing.view')
  findAllForProduct(@Param('productId') productId: string) {
    return this.service.findAllForProduct(productId);
  }

  @Post('products/:productId/cost-sheets')
  @RequirePermissions('costing.create')
  @ApiOperation({
    summary: 'Create the next cost sheet version',
    description:
      'Deactivates the previous active sheet. Material rates default to each material current average cost and are then frozen onto this sheet.',
  })
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateCostSheetDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.service.create(productId, dto, adminId);
  }

  @Get('cost-sheets/:id')
  @RequirePermissions('costing.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('cost-sheets/:id')
  @RequirePermissions('costing.update')
  @ApiOperation({
    summary: 'Correct a cost sheet in place',
    description:
      'For fixing a mistake. To record a genuine cost change, create a new version instead so past margins stay answerable.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateCostSheetDto) {
    return this.service.update(id, dto);
  }

  @Delete('cost-sheets/:id')
  @RequirePermissions('costing.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
