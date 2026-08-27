import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { VendorPaymentsService } from './vendor-payments.service';

/**
 * Lives here rather than in the vendors module because the ledger is built
 * almost entirely from payments and bills - keeping it beside that logic avoids
 * a circular dependency between the two modules.
 */
@ApiTags('Vendors (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/vendors')
export class VendorLedgerController {
  constructor(private service: VendorPaymentsService) {}

  @Get(':id/ledger')
  @RequirePermissions('vendors.view')
  @ApiOperation({
    summary: 'Vendor statement',
    description:
      'Bills and payments as one dated stream with a running balance, plus a summary. ' +
      'Everything is computed on read - no balance is stored anywhere.',
  })
  ledger(@Param('id') id: string) {
    return this.service.ledger(id);
  }
}
