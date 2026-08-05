import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesAdminController } from './categories-admin.controller';
import { CategoriesService } from './categories.service';

@Module({
  controllers: [CategoriesController, CategoriesAdminController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
