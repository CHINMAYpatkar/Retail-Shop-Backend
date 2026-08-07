import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { QueryOrdersAdminDto } from './dto/query-orders-admin.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('Orders (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private service: OrdersService) {}

  @Get()
  findAll(@Query() query: QueryOrdersAdminDto) {
    return this.service.findAllAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Get(':id/invoice')
  getInvoice(@Param('id') id: string) {
    return this.service.getInvoiceData(id);
  }

  @Patch(':id/status')
  @RequirePermissions('orders.update')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.service.updateStatus(id, dto.status, dto.note, adminId);
  }
}
