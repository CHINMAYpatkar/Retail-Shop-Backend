import { Module } from '@nestjs/common';
import { CmsPagesController } from './cms-pages.controller';
import { CmsPagesAdminController } from './cms-pages-admin.controller';
import { CmsPagesService } from './cms-pages.service';

@Module({
  controllers: [CmsPagesController, CmsPagesAdminController],
  providers: [CmsPagesService],
})
export class CmsPagesModule {}
