import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { OtpService } from './otp/otp.service';
import { TokensService, TokenPair } from './tokens.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

const PASSWORD_SALT_ROUNDS = 12;

@Injectable()
export class AdminAuthService {
  constructor(
    private prisma: PrismaService,
    private otp: OtpService,
    private mail: MailService,
    private tokens: TokensService,
  ) {}

  async login(dto: AdminLoginDto, meta: RequestMeta = {}): Promise<TokenPair> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    await this.prisma.activityLog.create({
      data: { adminUserId: admin.id, action: 'LOGIN', ipAddress: meta.ipAddress },
    });

    return this.tokens.issueAdminTokens(admin.id, admin.email, meta);
  }

  async refresh(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    return this.tokens.rotateAdminTokens(refreshToken, meta);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.tokens.revokeAdminRefreshToken(refreshToken);
    return { message: 'Logged out successfully' };
  }

  async forgotPassword(dto: RequestOtpDto): Promise<{ message: string }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    // Always respond the same way whether or not the account exists, to avoid account enumeration.
    if (admin && admin.isActive) {
      const code = await this.otp.issueOtp(dto.email, OtpPurpose.RESET_PASSWORD);
      await this.mail.sendOtpEmail(dto.email, code, OtpPurpose.RESET_PASSWORD);
    }
    return { message: 'If that account exists, a reset code has been sent' };
  }

  async resetPassword(dto: AdminResetPasswordDto): Promise<{ message: string }> {
    await this.otp.verifyOtp(dto.email, OtpPurpose.RESET_PASSWORD, dto.code);

    const passwordHash = await bcrypt.hash(dto.newPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.adminUser.update({
      where: { email: dto.email },
      data: { passwordHash },
    });

    return { message: 'Password reset successfully' };
  }

  async changePassword(adminId: string, dto: AdminChangePasswordDto): Promise<{ message: string }> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });

    const matches = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });

    return { message: 'Password changed successfully' };
  }
}
