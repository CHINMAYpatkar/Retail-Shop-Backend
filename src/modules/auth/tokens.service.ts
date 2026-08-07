import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

const REFRESH_TOKEN_SALT_ROUNDS = 10;

/**
 * Issues, rotates and revokes JWT access/refresh token pairs for BOTH
 * customer (storefront) and admin (CMS) principals. The two audiences use
 * entirely separate secrets so a leaked customer token can never be replayed
 * against admin routes and vice-versa.
 */
@Injectable()
export class TokensService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  // ---------- CUSTOMER ----------

  async issueCustomerTokens(customerId: string, email: string, meta: RequestMeta = {}): Promise<TokenPair> {
    const tokenId = uuidv4();
    const accessToken = this.jwt.sign(
      { sub: customerId, email },
      {
        secret: this.config.get<string>('jwt.customer.accessSecret'),
        expiresIn: this.config.get<string>('jwt.customer.accessExpiresIn'),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: customerId, tokenId },
      {
        secret: this.config.get<string>('jwt.customer.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.customer.refreshExpiresIn'),
      },
    );

    const tokenHash = await bcrypt.hash(refreshToken, REFRESH_TOKEN_SALT_ROUNDS);
    const expiresAt = this.decodeExpiry(refreshToken);

    await this.prisma.customerRefreshToken.create({
      data: {
        id: tokenId,
        customerId,
        tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return { accessToken, refreshToken };
  }

  async rotateCustomerTokens(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    let payload: { sub: string; tokenId: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('jwt.customer.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const record = await this.prisma.customerRefreshToken.findUnique({ where: { id: payload.tokenId } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const matches = await bcrypt.compare(refreshToken, record.tokenHash);
    if (!matches) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    // Rotate: revoke the used token, issue a brand new pair
    await this.prisma.customerRefreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueCustomerTokens(customer.id, customer.email, meta);
  }

  async revokeCustomerRefreshToken(refreshToken: string): Promise<void> {
    try {
      const payload: { tokenId: string } = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('jwt.customer.refreshSecret'),
      });
      await this.prisma.customerRefreshToken.update({
        where: { id: payload.tokenId },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Already invalid/expired - nothing to revoke, logout should still succeed.
    }
  }

  // ---------- ADMIN ----------

  async issueAdminTokens(adminId: string, email: string, meta: RequestMeta = {}): Promise<TokenPair> {
    const tokenId = uuidv4();
    const accessToken = this.jwt.sign(
      { sub: adminId, email },
      {
        secret: this.config.get<string>('jwt.admin.accessSecret'),
        expiresIn: this.config.get<string>('jwt.admin.accessExpiresIn'),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: adminId, tokenId },
      {
        secret: this.config.get<string>('jwt.admin.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.admin.refreshExpiresIn'),
      },
    );

    const tokenHash = await bcrypt.hash(refreshToken, REFRESH_TOKEN_SALT_ROUNDS);
    const expiresAt = this.decodeExpiry(refreshToken);

    await this.prisma.adminRefreshToken.create({
      data: {
        id: tokenId,
        adminUserId: adminId,
        tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return { accessToken, refreshToken };
  }

  async rotateAdminTokens(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    let payload: { sub: string; tokenId: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('jwt.admin.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const record = await this.prisma.adminRefreshToken.findUnique({ where: { id: payload.tokenId } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const matches = await bcrypt.compare(refreshToken, record.tokenHash);
    if (!matches) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    await this.prisma.adminRefreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueAdminTokens(admin.id, admin.email, meta);
  }

  async revokeAdminRefreshToken(refreshToken: string): Promise<void> {
    try {
      const payload: { tokenId: string } = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('jwt.admin.refreshSecret'),
      });
      await this.prisma.adminRefreshToken.update({
        where: { id: payload.tokenId },
        data: { revokedAt: new Date() },
      });
    } catch {
      // no-op
    }
  }

  private decodeExpiry(token: string): Date {
    const decoded: any = this.jwt.decode(token);
    return decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
}
