import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

// StorageModule is @Global, so no import needed for StorageService. The old
// UploadsModule dependency existed only to reach S3Service for deletes.
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
