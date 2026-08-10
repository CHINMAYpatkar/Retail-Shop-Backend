// import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
// import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
// import { AdminRoleName } from '@prisma/client';
// import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
// import { RolesGuard } from '../../common/guards/roles.guard';
// import { Roles } from '../../common/decorators/roles.decorator';
// import { SettingsService } from './settings.service';
// import { UpsertSettingDto } from './dto/upsert-setting.dto';

// @ApiTags('Settings (Admin)')
// @ApiBearerAuth()
// @UseGuards(JwtAdminAuthGuard, RolesGuard)
// @Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
// @Controller('admin/settings')
// export class SettingsAdminController {
//   constructor(private service: SettingsService) {}

//   @Get()
//   findAll() {
//     return this.service.findAllAdmin();
//   }

//   @Get(':key')
//   findOne(@Param('key') key: string) {
//     return this.service.findOne(key);
//   }

//   @Put(':key')
//   upsert(@Param('key') key: string, @Body() dto: UpsertSettingDto) {
//     return this.service.upsert(key, dto.value);
//   }
// }

import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRoleName } from '@prisma/client';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MailService } from '../notifications/mail.service';
import { SettingsService } from './settings.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';
import { TestEmailDto } from './dto/test-email.dto';

@ApiTags('Settings (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAdminAuthGuard, RolesGuard)
@Roles(AdminRoleName.SUPER_ADMIN, AdminRoleName.ADMIN)
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(
    private service: SettingsService,
    private mail: MailService,
  ) {}

  // Declared before the ':key' wildcard route below so it can never be
  // shadowed by an arbitrary setting key of the same name.
  @Get('system/smtp-status')
  getSmtpStatus() {
    return this.mail.getStatus();
  }

  @Post('system/test-email')
  sendTestEmail(@Body() dto: TestEmailDto) {
    return this.mail.sendTestEmail(dto.to);
  }

  @Get()
  findAll() {
    return this.service.findAllAdmin();
  }

  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.service.findOne(key);
  }

  @Put(':key')
  upsert(@Param('key') key: string, @Body() dto: UpsertSettingDto) {
    return this.service.upsert(key, dto.value);
  }
}