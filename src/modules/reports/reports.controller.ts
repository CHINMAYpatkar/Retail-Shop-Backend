import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ReportsService } from './reports.service';
import { DateRangeDto } from './dto/date-range.dto';

/** SUPER_ADMIN/ADMIN only - this is the most sensitive data in the system. */
@ApiTags('Reports (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('profit-loss')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'Profit and loss',
    description:
      'Net revenue (delivered orders less completed refunds) minus COGS minus expenses. ' +
      'Always check `cost.coverage`: cost data is optional per order item, and an incomplete COGS overstates profit.',
  })
  profitAndLoss(@Query() query: DateRangeDto) {
    return this.service.profitAndLoss(query);
  }

  @Get('vendor-payables')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'Vendor payables with aging',
    description: 'Outstanding per vendor, bucketed by how overdue each unpaid bill is.',
  })
  vendorPayables() {
    return this.service.vendorPayables();
  }

  @Get('stock-valuation')
  @RequirePermissions('reports.view')
  @ApiOperation({
    summary: 'Raw material stock valuation',
    description:
      'Stock on hand valued at average cost. Materials with no recorded cost are counted separately rather than valued at zero.',
  })
  stockValuation() {
    return this.service.stockValuation();
  }

  @Get('purchase-summary')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Purchase spend by vendor and by material' })
  purchaseSummary(@Query() query: DateRangeDto) {
    return this.service.purchaseSummary(query);
  }
}
