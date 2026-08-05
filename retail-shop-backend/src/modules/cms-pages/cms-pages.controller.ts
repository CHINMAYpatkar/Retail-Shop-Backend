import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CmsPagesService } from './cms-pages.service';

@ApiTags('CMS Pages (Public)')
@Controller('cms/pages')
export class CmsPagesController {
  constructor(private service: CmsPagesService) {}

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOnePublic(slug);
  }
}
