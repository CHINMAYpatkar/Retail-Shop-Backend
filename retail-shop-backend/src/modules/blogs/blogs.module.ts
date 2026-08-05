import { Module } from '@nestjs/common';
import { BlogsController } from './blogs.controller';
import { BlogsAdminController } from './blogs-admin.controller';
import { BlogsService } from './blogs.service';

@Module({
  controllers: [BlogsController, BlogsAdminController],
  providers: [BlogsService],
})
export class BlogsModule {}
