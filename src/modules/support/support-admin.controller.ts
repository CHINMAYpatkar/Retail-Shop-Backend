import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { QueryTicketsAdminDto } from './dto/query-tickets-admin.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';

@ApiTags('Support (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN, AdminRoleName.MANAGER, AdminRoleName.STAFF)
@Controller('admin/support/tickets')
export class SupportAdminController {
  constructor(private service: SupportService) {}

  @Get()
  findAll(@Query() query: QueryTicketsAdminDto) {
    return this.service.findAllAdmin(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOneAdmin(id);
  }

  @Post(':id/messages')
  reply(@Param('id') id: string, @Body() dto: AddMessageDto, @CurrentUser('name') adminName: string) {
    return this.service.addAdminReply(id, dto.message, adminName);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
