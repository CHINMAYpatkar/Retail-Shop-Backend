import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { ImageProcessorService } from './image-processor.service';
import { S3Service } from './s3.service';

/**
 * `S3Service` is intentionally still provided: it is most of a future
 * `S3Driver` and deleting it would mean rewriting the presign/delete logic
 * when AWS is set up. It is not used by anything today.
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService, ImageProcessorService, S3Service],
  exports: [UploadsService, S3Service],
})
export class UploadsModule {}
