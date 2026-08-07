import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { FaqsService } from './faqs.service';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';

@ApiTags('FAQs (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER)
@Controller('admin/faqs')
export class FaqsAdminController {
  constructor(private service: FaqsService) {}

  @Get()
  findAll() {
    return this.service.findAllAdmin();
  }

  @Post()
  @RequirePermissions('faqs.create')
  create(@Body() dto: CreateFaqDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('faqs.update')
  update(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('faqs.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
