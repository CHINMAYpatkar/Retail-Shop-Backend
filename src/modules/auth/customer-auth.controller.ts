import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtCustomerAuthGuard } from '../../common/guards/jwt-customer-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

function meta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

/**
 * Name of the refresh cookie. Prefixed so it is obvious in devtools which
 * audience it belongs to - the admin app has its own, and confusing the two
 * while debugging costs an afternoon.
 */
const REFRESH_COOKIE = 'rs_customer_refresh';

@ApiTags('Customer Auth')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(
    private authService: CustomerAuthService,
    private config: ConfigService,
  ) {}

  /**
   * Cookie options for the refresh token.
   *
   * **httpOnly** is the whole point: a refresh token is long-lived, and one
   * readable by JavaScript is one that a single XSS turns into permanent
   * account access. In a cookie the browser will send it and script cannot read
   * it, so the worst an injected script can do is ride the session while the
   * page is open rather than walk away with it.
   *
   * **sameSite lax** blocks the cookie on cross-site POSTs, which is what stops
   * another origin silently refreshing a session. Lax rather than strict so a
   * normal link into the site still works.
   *
   * **secure** only outside development, because localhost is plain http and a
   * secure cookie would simply never be set.
   *
   * **path** scopes it to the customer auth routes. The cookie is useless
   * anywhere else, and not sending it on every product image request is both
   * faster and a smaller surface.
   */
  private refreshCookieOptions() {
    const prefix = this.config.get<string>('apiPrefix') || 'api/v1';
    const isProduction = this.config.get<string>('nodeEnv') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: `/${prefix}/auth/customer`,
      // Matches the refresh token's own lifetime. A cookie that outlives the
      // token it carries just produces confusing 401s on a token the browser
      // still believes in.
      maxAge: 1000 * 60 * 60 * 24 * 30,
    };
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a sign-in code',
    description:
      'One entry point for signing in and signing up. The response is identical whether or not the address is registered, so it cannot be used to discover who has an account.',
  })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the code and sign in',
    description:
      'Returns an access token in the body and sets the refresh token as an httpOnly cookie. `isNewCustomer` and `profileComplete` tell the storefront whether to show the registration form or go straight in.',
  })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.authService.verifyOtp(dto, meta(req));
    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
    // The refresh token is deliberately NOT in the body. Returning it as well
    // would hand the client a copy to store somewhere script-readable, which is
    // exactly what putting it in an httpOnly cookie was meant to prevent.
    return rest;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    const { refreshToken, ...rest } = await this.authService.refresh(token ?? '', meta(req));

    // Rotated on every use, so the new one has to replace the old cookie.
    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
    return rest;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the refresh token and clear the cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];

    // Clear the cookie regardless of whether revocation succeeded. If the token
    // was already invalid the customer still asked to be signed out, and leaving
    // a dead cookie behind makes the next request fail confusingly instead of
    // simply being signed out.
    res.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());

    if (!token) return { message: 'Logged out successfully' };
    return this.authService.logout(token);
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
  @ApiOperation({ summary: "The signed-in customer's own profile" })
  @UseGuards(JwtCustomerAuthGuard)
  me(@CurrentUser('id') customerId: string) {
    return this.authService.getProfile(customerId);
  }

  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Complete or update the profile',
    description: 'Name and contact number. Addresses are managed under customer/addresses.',
  })
  @UseGuards(JwtCustomerAuthGuard)
  updateProfile(@CurrentUser('id') customerId: string, @Body() dto: UpdateCustomerProfileDto) {
    return this.authService.updateProfile(customerId, dto);
  }
}
