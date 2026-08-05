import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FaqsService } from './faqs.service';

@ApiTags('FAQs (Public)')
@Controller('faqs')
export class FaqsController {
  constructor(private service: FaqsService) {}

  @Get()
  findAll() {
    return this.service.findAllPublic();
  }
}
