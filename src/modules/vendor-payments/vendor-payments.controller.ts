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
import { VendorPaymentsService } from './vendor-payments.service';
import { CreateVendorPaymentDto } from './dto/create-vendor-payment.dto';
import { UpdateVendorPaymentDto } from './dto/update-vendor-payment.dto';
import { QueryVendorPaymentsDto } from './dto/query-vendor-payments.dto';

/** SUPER_ADMIN/ADMIN only - vendor balances are commercially sensitive. */
@ApiTags('Vendor Payments (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/vendor-payments')
export class VendorPaymentsController {
  constructor(private service: VendorPaymentsService) {}

  @Get()
  @RequirePermissions('vendor-payments.view')
  findAll(@Query() query: QueryVendorPaymentsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('vendor-payments.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('vendor-payments.create')
  @ApiOperation({
    summary: 'Record a payment to a vendor',
    description:
      'Link it to a bill to settle that bill, or omit the bill for an on-account payment (an advance). ' +
      'A bill-linked payment cannot exceed that bill outstanding amount.',
  })
  create(@Body() dto: CreateVendorPaymentDto, @CurrentUser('id') adminId: string) {
    return this.service.create(dto, adminId);
  }

  @Patch(':id')
  @RequirePermissions('vendor-payments.update')
  update(@Param('id') id: string, @Body() dto: UpdateVendorPaymentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('vendor-payments.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
