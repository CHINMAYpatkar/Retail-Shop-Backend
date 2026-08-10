import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsService } from './settings.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [SettingsController, SettingsAdminController],
  providers: [SettingsService],
})
export class SettingsModule {}
