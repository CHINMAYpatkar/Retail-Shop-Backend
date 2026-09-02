import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { QueryMediaDto } from './dto/query-media.dto';

@ApiTags('Media Library (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
// STAFF is absent deliberately: its entire grant is orders.view and
// support.view, and the media library is not part of either job.
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER)
@Controller('admin/media')
export class MediaController {
  constructor(private service: MediaService) {}

  @Get()
  @RequirePermissions('media.view')
  findAll(@Query() query: QueryMediaDto) {
    return this.service.findAll(query);
  }

  @Post()
  @RequirePermissions('media.create')
  create(@Body() dto: CreateMediaAssetDto, @CurrentUser('id') adminId: string) {
    return this.service.create(dto, adminId);
  }

  @Delete(':id')
  // Hard-deletes the row AND the bytes. MediaAsset is the attachment target
  // for purchase bills, vendor payments and expenses, so this can clear the
  // scan of a financial record - hence back-office only.
  @RequirePermissions('media.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
