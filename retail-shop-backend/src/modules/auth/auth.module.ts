import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { TokensService } from './tokens.service';
import { OtpService } from './otp/otp.service';
import { JwtCustomerStrategy } from './strategies/jwt-customer.strategy';
import { JwtAdminStrategy } from './strategies/jwt-admin.strategy';

@Module({
  imports: [
    PassportModule,
    // No default secret/expiry here - every sign()/verify() call explicitly
    // passes the right secret for its audience (customer vs admin, access vs refresh).
    JwtModule.register({}),
    NotificationsModule,
  ],
  controllers: [CustomerAuthController, AdminAuthController],
  providers: [
    CustomerAuthService,
    AdminAuthService,
    TokensService,
    OtpService,
    JwtCustomerStrategy,
    JwtAdminStrategy,
  ],
  exports: [TokensService],
})
export class AuthModule {}
