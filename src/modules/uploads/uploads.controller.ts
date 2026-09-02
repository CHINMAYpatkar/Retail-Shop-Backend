import {
  BadRequestException,
  ForbiddenException,
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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { isPrivateFolder } from '../storage/storage.constants';
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
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
// STAFF is absent deliberately: uploading writes bytes to disk, and STAFF's
// entire grant is orders.view and support.view.
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER)
@Controller('admin/uploads')
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  @Post()
  @RequirePermissions('media.create')
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
    @CurrentUser() user: { roleName: string; permissions: string[] },
  ) {
    if (!file) throw new BadRequestException('No file was uploaded (expected field "file")');

    const folder = dto.folder || 'misc';

    // Private folders hold bill and receipt scans. Writing there is part of
    // the purchase-bills workflow, and only back-office roles can read them
    // back - so letting anyone else write would create files nobody who put
    // them there could ever retrieve.
    if (isPrivateFolder(folder) && !this.canWritePrivate(user)) {
      throw new ForbiddenException('You do not have permission to upload to this folder');
    }

    return this.uploads.handleUpload(file, folder);
  }

  /** SUPER_ADMIN bypasses granular checks, matching PermissionsGuard. */
  private canWritePrivate(user: { roleName: string; permissions: string[] }): boolean {
    return (
      user?.roleName === AdminRoleName.SUPER_ADMIN ||
      (user?.permissions || []).includes('purchase-bills.create')
    );
  }
}
