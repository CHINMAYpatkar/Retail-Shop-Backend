import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BannerPlacement } from '@prisma/client';
import { BannersService } from './banners.service';

@ApiTags('Banners (Public)')
@Controller('banners')
export class BannersController {
  constructor(private service: BannersService) {}

  @Get()
  findAll(@Query('placement') placement?: BannerPlacement) {
    return this.service.findAllPublic(placement);
  }
}
