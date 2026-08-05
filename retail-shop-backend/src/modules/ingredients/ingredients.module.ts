import { Module } from '@nestjs/common';
import { IngredientsController } from './ingredients.controller';
import { IngredientsAdminController } from './ingredients-admin.controller';
import { IngredientsService } from './ingredients.service';

@Module({
  controllers: [IngredientsController, IngredientsAdminController],
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class IngredientsModule {}
