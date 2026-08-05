import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { QueryMediaDto } from './dto/query-media.dto';

@ApiTags('Media Library (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/media')
export class MediaController {
  constructor(private service: MediaService) {}

  @Get()
  findAll(@Query() query: QueryMediaDto) {
    return this.service.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateMediaAssetDto, @CurrentUser('id') adminId: string) {
    return this.service.create(dto, adminId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
