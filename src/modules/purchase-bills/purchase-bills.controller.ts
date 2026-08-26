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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PurchaseBillsService } from './purchase-bills.service';
import { CreatePurchaseBillDto } from './dto/create-purchase-bill.dto';
import { UpdatePurchaseBillDto } from './dto/update-purchase-bill.dto';
import { QueryPurchaseBillsDto } from './dto/query-purchase-bills.dto';

/** SUPER_ADMIN/ADMIN only - purchase pricing is commercially sensitive. */
@ApiTags('Purchase Bills (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/purchase-bills')
export class PurchaseBillsController {
  constructor(private service: PurchaseBillsService) {}

  @Get()
  @RequirePermissions('purchase-bills.view')
  findAll(@Query() query: QueryPurchaseBillsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('purchase-bills.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('purchase-bills.create')
  @ApiOperation({
    summary: 'Record a purchase bill',
    description:
      'Adds the quantities to raw-material stock and recomputes each affected material\u2019s average cost. ' +
      'Totals are computed from the line items - do not send them.',
  })
  create(@Body() dto: CreatePurchaseBillDto, @CurrentUser('id') adminId: string) {
    return this.service.create(dto, adminId);
  }

  @Patch(':id')
  @RequirePermissions('purchase-bills.update')
  @ApiOperation({
    summary: 'Update a purchase bill',
    description:
      'Supplying `items` replaces every line: the original stock effect is reversed and the new one applied, ' +
      'in a single transaction. Omit `items` to edit only the header fields.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseBillDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.service.update(id, dto, adminId);
  }

  @Delete(':id')
  @RequirePermissions('purchase-bills.delete')
  @ApiOperation({
    summary: 'Delete a purchase bill',
    description: 'Reverses its stock effect. Refused while payments are recorded against it.',
  })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
