import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

function meta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

@ApiTags('Customer Auth')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private authService: CustomerAuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  verifyRegisterOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.authService.verifyRegisterOtp(dto, meta(req));
  }

  @Post('login/request-otp')
  @HttpCode(HttpStatus.OK)
  requestLoginOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestLoginOtp(dto);
  }

  @Post('login/verify')
  @HttpCode(HttpStatus.OK)
  verifyLoginOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.authService.verifyLoginOtp(dto, meta(req));
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
}
