import { Module } from '@nestjs/common';
import { RecipesController } from './recipes.controller';
import { RecipesAdminController } from './recipes-admin.controller';
import { RecipesService } from './recipes.service';

@Module({
  controllers: [RecipesController, RecipesAdminController],
  providers: [RecipesService],
})
export class RecipesModule {}
