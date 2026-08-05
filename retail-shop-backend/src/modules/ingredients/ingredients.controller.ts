import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IngredientsService } from './ingredients.service';

@ApiTags('Ingredients (Public)')
@Controller('ingredients')
export class IngredientsController {
  constructor(private service: IngredientsService) {}

  @Get()
  findAll() {
    return this.service.findAllPublic();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOnePublicBySlug(slug);
  }
}
