import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('summary')
  getSummary() {
    return this.service.getSummary();
  }
}
