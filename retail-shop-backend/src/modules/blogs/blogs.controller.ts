import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BlogsService } from './blogs.service';

@ApiTags('Blogs (Public)')
@Controller('blogs')
export class BlogsController {
  constructor(private service: BlogsService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAllPublic(query);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.service.findOnePublicBySlug(slug);
  }
}
