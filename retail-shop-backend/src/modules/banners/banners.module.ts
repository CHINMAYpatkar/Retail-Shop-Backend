import { Module } from '@nestjs/common';
import { BannersController } from './banners.controller';
import { BannersAdminController } from './banners-admin.controller';
import { BannersService } from './banners.service';

@Module({
  controllers: [BannersController, BannersAdminController],
  providers: [BannersService],
})
export class BannersModule {}
