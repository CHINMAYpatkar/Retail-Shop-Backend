import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadsService } from './uploads.service';

/**
 * Multipart upload, replacing the previous S3 presign flow.
 *
 * With local-disk storage the bytes have to pass through the API rather than
 * going browser-to-bucket, so this is a rewrite rather than a reconfiguration.
 * See ADR 0008.
 *
 * The multer limit below is the LARGEST of the per-type caps, because the real
 * type is only known after the bytes are sniffed. The per-category cap is then
 * enforced in the service. Consequence: a 150MB file claiming to be an image is
 * buffered before being rejected. Acceptable for admin-authenticated uploads;
 * MED-08 (video) should revisit this with streaming to a temp file so large
 * video never sits in memory.
 */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

@ApiTags('Uploads (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/uploads')
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  @Post()
  @ApiOperation({
    summary: 'Upload a file',
    description:
      'The file type is determined from the file bytes, not the declared Content-Type or filename. ' +
      'Images are re-encoded to WebP with all metadata (including EXIF GPS) stripped.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded (expected field "file")');
    return this.uploads.handleUpload(file, dto.folder || 'misc');
  }
}
