import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadsService } from './uploads.service';
import { ReviewImageUploadDto } from './dto/review-image-upload.dto';

/**
 * The only endpoint through which a customer can write a file to this server.
 *
 * Tighter than the admin equivalent in three ways:
 *  - images only (enforced from the bytes, before anything is stored)
 *  - a 5MB hard cap at the multer layer, so an oversized upload is cut off
 *    during streaming rather than after being buffered
 *  - rate limited well below the global throttle, because this is the one
 *    write-to-disk path exposed to the public internet
 */
const CUSTOMER_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@ApiTags('Uploads (Customer)')
@ApiBearerAuth()
@UseGuards(JwtCustomerAuthGuard)
@Controller('customer/uploads')
export class CustomerUploadsController {
  constructor(private uploads: UploadsService) {}

  @Post('review-image')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Upload an image to attach to a review',
    description:
      'Requires a DELIVERED order containing the product. Returns a storageKey to pass in the ' +
      'review payload. Images are re-encoded to WebP and all metadata, including EXIF GPS, is removed.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CUSTOMER_MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async uploadReviewImage(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: ReviewImageUploadDto,
    @CurrentUser('id') customerId: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded (expected field "file")');
    return this.uploads.handleCustomerReviewUpload(file, customerId, query.productId);
  }
}
