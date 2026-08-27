import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { UpdateRefundDto } from './dto/update-refund.dto';
import { QueryRefundsDto } from './dto/query-refunds.dto';

/**
 * Refunds are recorded, not executed - there is no payment gateway, so a human
 * sends the money and this captures the fact. See ADR 0012.
 *
 * Note there is no DELETE: a mistake is corrected with a FAILED status or a
 * compensating entry, never by removing a financial record.
 */
@ApiTags('Refunds (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin')
export class RefundsController {
  constructor(private service: RefundsService) {}

  @Get('refunds')
  @RequirePermissions('refunds.view')
  @ApiOperation({
    summary: 'All refunds',
    description: 'The reconciliation view. Summary reports completed and still-pending amounts.',
  })
  findAll(@Query() query: QueryRefundsDto) {
    return this.service.findAll(query);
  }

  @Get('orders/:orderId/refunds')
  @RequirePermissions('refunds.view')
  findForOrder(@Param('orderId') orderId: string) {
    return this.service.findForOrder(orderId);
  }

  @Post('orders/:orderId/refunds')
  @RequirePermissions('refunds.create')
  @ApiOperation({
    summary: 'Record a refund against an order',
    description:
      'Allowed only on DELIVERED, RETURNED, REFUNDED or CANCELLED orders - payment is collected on delivery, so nothing is refundable before then. The total refunded can never exceed the order total.',
  })
  create(
    @Param('orderId') orderId: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.service.create(orderId, dto, adminId);
  }

  @Patch('refunds/:id')
  @RequirePermissions('refunds.update')
  @ApiOperation({
    summary: 'Update a refund',
    description:
      'Typically to mark it COMPLETED once the money has actually been sent, which is what updates the order payment status.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateRefundDto) {
    return this.service.update(id, dto);
  }
}
