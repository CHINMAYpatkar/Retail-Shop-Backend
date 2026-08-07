import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AdminJwtPayload {
  sub: string; // admin user id
  email: string;
}

@Injectable()
export class JwtAdminStrategy extends PassportStrategy(Strategy, 'jwt-admin') {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.admin.accessSecret'),
    });
  }

  async validate(payload: AdminJwtPayload) {
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!adminUser || !adminUser.isActive) {
      return null;
    }

    return {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      type: 'admin' as const,
      roleName: adminUser.role.name,
      permissions: adminUser.role.permissions.map((rp) => rp.permission.key),
    };
  }
}
