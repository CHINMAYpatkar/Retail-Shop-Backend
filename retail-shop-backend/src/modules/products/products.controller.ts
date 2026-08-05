import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { QueryProductsDto } from './dto/query-products.dto';

@ApiTags('Products (Public)')
@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductsDto) {
    return this.service.findAllPublic(query);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOnePublicBySlug(slug);
  }
}
