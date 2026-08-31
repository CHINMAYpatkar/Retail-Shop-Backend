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

  /**
   * The signed-in admin's own profile, including the permission keys their role
   * grants.
   *
   * Deliberately here rather than reusing `GET /admin/users/:id` + `GET
   * /admin/roles`: both of those are gated to SUPER_ADMIN/ADMIN at the ROLE
   * level, so a MANAGER or STAFF account could not read its own profile and
   * therefore could not complete login at all.
   *
   * Knowing who you are is not user management, so this endpoint carries no
   * role or permission gate beyond being authenticated. It also stops the
   * client having to pull every role with every permission just to find its
   * own - which leaked the whole permission matrix to any admin who logged in.
   */
  async getProfile(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        lastLoginAt: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    if (!admin) throw new UnauthorizedException('Admin account not found');
    if (!admin.isActive) throw new UnauthorizedException('This account has been deactivated');

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      lastLoginAt: admin.lastLoginAt,
      role: { id: admin.role.id, name: admin.role.name, description: admin.role.description },
      // Flat list of keys - the only shape the client actually needs.
      permissions: admin.role.permissions.map((rp) => rp.permission.key),
    };
  }
}
