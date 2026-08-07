import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { JwtAdminAuthGuard } from '../../common/guards/jwt-admin-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function meta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

@ApiTags('Admin Auth')
@Controller('auth/admin')
export class AdminAuthController {
  constructor(private authService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.authService.login(dto, meta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, meta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: RequestOtpDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: AdminResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAdminAuthGuard)
  changePassword(@CurrentUser('id') adminId: string, @Body() dto: AdminChangePasswordDto) {
    return this.authService.changePassword(adminId, dto);
  }
}
