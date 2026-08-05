import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRoleName } from '@prisma/client';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Controller('admin/permissions')
export class PermissionsController {
  constructor(private service: PermissionsService) {}

  @Get()
  @Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
  findAll() {
    return this.service.findAll();
  }
}
