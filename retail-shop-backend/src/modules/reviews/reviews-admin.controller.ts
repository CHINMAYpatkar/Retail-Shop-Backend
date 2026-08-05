import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ReviewsService } from './reviews.service';
import { QueryReviewsAdminDto } from './dto/query-reviews-admin.dto';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';

@ApiTags('Reviews (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/reviews')
export class ReviewsAdminController {
  constructor(private service: ReviewsService) {}

  @Get()
  findAll(@Query() query: QueryReviewsAdminDto) {
    return this.service.findAllAdmin(query);
  }

  @Patch(':id/status')
  @RequirePermissions('reviews.update')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateReviewStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }

  @Patch(':id/reply')
  @RequirePermissions('reviews.update')
  reply(@Param('id') id: string, @Body() dto: ReplyReviewDto) {
    return this.service.reply(id, dto.reply);
  }

  @Delete(':id')
  @RequirePermissions('reviews.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
