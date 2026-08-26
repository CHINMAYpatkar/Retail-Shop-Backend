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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { QueryVendorsDto } from './dto/query-vendors.dto';

/**
 * Restricted to SUPER_ADMIN and ADMIN at the ROLE level, not just by permission.
 *
 * Supplier identity and purchase pricing are commercially sensitive - a STAFF
 * account that exists to move order statuses has no business reading them. The
 * role gate means this stays true even if someone later grants `vendors.view`
 * to a lower role by mistake.
 */
@ApiTags('Vendors (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/vendors')
export class VendorsController {
  constructor(private service: VendorsService) {}

  @Get()
  @RequirePermissions('vendors.view')
  findAll(@Query() query: QueryVendorsDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('vendors.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('vendors.create')
  create(@Body() dto: CreateVendorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('vendors.update')
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('vendors.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
