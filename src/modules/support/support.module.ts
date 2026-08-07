import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportController } from './support.controller';
import { SupportAdminController } from './support-admin.controller';
import { SupportService } from './support.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
})
export class SupportModule {}
