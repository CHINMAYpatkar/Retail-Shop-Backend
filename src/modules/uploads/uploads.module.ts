import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { CustomerUploadsController } from './customer-uploads.controller';
import { DocumentsController } from './documents.controller';
import { UploadsService } from './uploads.service';
import { ImageProcessorService } from './image-processor.service';
import { S3Service } from './s3.service';
import { MediaModule } from '../media/media.module';

/**
 * `S3Service` is intentionally still provided: it is most of a future
 * `S3Driver` and deleting it would mean rewriting the presign/delete logic
 * when AWS is set up. It is not used by anything today.
 */
@Module({
  imports: [MediaModule],
  controllers: [UploadsController, CustomerUploadsController, DocumentsController],
  providers: [UploadsService, ImageProcessorService, S3Service],
  exports: [UploadsService, S3Service],
})
export class UploadsModule {}
