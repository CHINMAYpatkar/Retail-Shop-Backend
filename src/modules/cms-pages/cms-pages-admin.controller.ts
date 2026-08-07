import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CmsPagesService } from './cms-pages.service';
import { UpsertCmsPageDto } from './dto/upsert-cms-page.dto';

@ApiTags('CMS Pages (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER)
@Controller('admin/cms/pages')
export class CmsPagesAdminController {
  constructor(private service: CmsPagesService) {}

  @Get()
  findAll() {
    return this.service.findAllAdmin();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOneAdmin(slug);
  }

  @Post()
  @RequirePermissions('cms.create', 'cms.update')
  upsert(@Body() dto: UpsertCmsPageDto) {
    return this.service.upsert(dto);
  }

  @Delete(':slug')
  @RequirePermissions('cms.delete')
  remove(@Param('slug') slug: string) {
    return this.service.remove(slug);
  }
}
