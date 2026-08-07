import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsAdminController } from './products-admin.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, ProductsAdminController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
