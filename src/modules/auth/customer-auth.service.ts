import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { OtpService } from './otp/otp.service';
import { TokensService, TokenPair } from './tokens.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RequestOtpDto } from './dto/request-otp.dto';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class CustomerAuthService {
  constructor(
    private prisma: PrismaService,
    private otp: OtpService,
    private mail: MailService,
    private tokens: TokensService,
  ) {}

  /**
   * Step 1 of registration: create (or reuse) an unverified customer record
   * and email them a 6-digit OTP. No password is required — auth is OTP-first.
   */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    let customer = await this.prisma.customer.findUnique({ where: { email: dto.email } });

    if (customer?.emailVerifiedAt) {
      throw new BadRequestException(
        'An account with this email already exists. Please login instead.',
      );
    }

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { email: dto.email, name: dto.name },
      });
    }

    const code = await this.otp.issueOtp(dto.email, OtpPurpose.REGISTER, customer.id);
    await this.mail.sendOtpEmail(dto.email, code, OtpPurpose.REGISTER);

    return { message: 'Verification code sent to your email' };
  }

  /** Step 2 of registration: verify the OTP and issue tokens. */
  async verifyRegisterOtp(dto: VerifyOtpDto, meta: RequestMeta = {}): Promise<TokenPair> {
    await this.otp.verifyOtp(dto.email, OtpPurpose.REGISTER, dto.code);

    const customer = await this.prisma.customer.update({
      where: { email: dto.email },
      data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    });

    return this.tokens.issueCustomerTokens(customer.id, customer.email, meta);
  }

  /** Passwordless login step 1: send an OTP to an existing, verified customer. */
  async requestLoginOtp(dto: RequestOtpDto): Promise<{ message: string }> {
    const customer = await this.prisma.customer.findUnique({ where: { email: dto.email } });

    if (!customer || !customer.emailVerifiedAt) {
      // Avoid confirming whether an email is registered - respond generically either way.
      throw new NotFoundException('No verified account found for this email');
    }
    if (!customer.isActive) {
      throw new BadRequestException('This account has been deactivated');
    }

    const code = await this.otp.issueOtp(dto.email, OtpPurpose.LOGIN, customer.id);
    await this.mail.sendOtpEmail(dto.email, code, OtpPurpose.LOGIN);

    return { message: 'Login code sent to your email' };
  }

  /** Passwordless login step 2: verify the OTP and issue tokens. */
  async verifyLoginOtp(dto: VerifyOtpDto, meta: RequestMeta = {}): Promise<TokenPair> {
    await this.otp.verifyOtp(dto.email, OtpPurpose.LOGIN, dto.code);

    const customer = await this.prisma.customer.update({
      where: { email: dto.email },
      data: { lastLoginAt: new Date() },
    });

    if (meta.userAgent || meta.ipAddress) {
      await this.prisma.customerSession.create({
        data: { customerId: customer.id, userAgent: meta.userAgent, ipAddress: meta.ipAddress },
      });
    }

    return this.tokens.issueCustomerTokens(customer.id, customer.email, meta);
  }

  async refresh(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    return this.tokens.rotateCustomerTokens(refreshToken, meta);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.tokens.revokeCustomerRefreshToken(refreshToken);
    return { message: 'Logged out successfully' };
  }
}
