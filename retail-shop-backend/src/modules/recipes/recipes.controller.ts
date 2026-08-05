import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecipesService } from './recipes.service';

@ApiTags('Recipes (Public)')
@Controller('recipes')
export class RecipesController {
  constructor(private service: RecipesService) {}

  @Get()
  findAll() {
    return this.service.findAllPublic();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOnePublicBySlug(slug);
  }
}
