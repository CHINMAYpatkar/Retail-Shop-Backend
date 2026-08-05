import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { S3Service } from './s3.service';
import { PresignDto } from './dto/presign.dto';

@ApiTags('Uploads (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/uploads/presign')
export class UploadsController {
  constructor(private s3: S3Service) {}

  @Post()
  presign(@Body() dto: PresignDto) {
    return this.s3.getPresignedUploadUrl(dto.fileName, dto.contentType, dto.folder);
  }
}
