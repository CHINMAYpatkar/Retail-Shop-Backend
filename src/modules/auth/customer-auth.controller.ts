import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  /**
   * The signed-in customer's own profile.
   *
   * `JwtCustomerAuthGuard` and nothing else. Reading your own identity is
   * unprivileged by definition, and gating it any further is precisely how the
   * admin side once locked every non-ADMIN role out of the product.
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The signed-in customer's own profile",
    description:
      'Identity only: id, name, email, whether the address is verified. Available to any authenticated customer.',
  })
  @UseGuards(JwtCustomerAuthGuard)
  me(@CurrentUser('id') customerId: string) {
    return this.authService.getProfile(customerId);
  }
}
