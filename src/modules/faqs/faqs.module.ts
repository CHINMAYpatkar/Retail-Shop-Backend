import { Module } from '@nestjs/common';
import { FaqsController } from './faqs.controller';
import { FaqsAdminController } from './faqs-admin.controller';
import { FaqsService } from './faqs.service';

@Module({
  controllers: [FaqsController, FaqsAdminController],
  providers: [FaqsService],
})
export class FaqsModule {}
