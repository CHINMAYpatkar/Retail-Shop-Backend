import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { Response } from 'express';
import { createReadStream, promises as fs } from 'fs';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

/**
 * Authenticated read access to private assets - purchase-bill and payment-receipt
 * scans, which are business financial records.
 *
 * These live under `uploads/private/`, which the static mount cannot see, so
 * this controller is the only way to read them. Restricted to SUPER_ADMIN and
 * ADMIN, matching the decision that supplier pricing and cost data are not
 * MANAGER/STAFF information.
 */
@ApiTags('Documents (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/documents')
export class DocumentsController {
  constructor(
    private media: MediaService,
    private storage: StorageService,
  ) {}

  @Get(':mediaId')
  @ApiOperation({
    summary: 'Stream a private document',
    description: 'Served as an attachment so an uploaded file can never render in this origin.',
  })
  async streamDocument(
    @Param('mediaId') mediaId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const asset = await this.media.findRecord(mediaId);

    if (!asset.storageKey) {
      throw new NotFoundException('This asset is an external link, not a stored file');
    }

    const absolutePath = this.storage.localPath(asset.storageKey);
    if (!absolutePath) {
      // Either the key escapes the storage root, or the active driver isn't
      // disk-backed. Neither is something to expose details about.
      throw new NotFoundException('Document is not available from this server');
    }

    try {
      await fs.access(absolutePath);
    } catch {
      // Row exists, bytes don't - an orphaned record. Worth surfacing plainly
      // rather than as a stream error, since it means storage and DB disagree.
      throw new NotFoundException('Document record exists but the file is missing from storage');
    }

    res.set({
      'Content-Type': asset.mimeType || 'application/octet-stream',
      // Never inline: a stored PDF or SVG must not be interpreted in this origin.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(asset.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(createReadStream(absolutePath));
  }
}
