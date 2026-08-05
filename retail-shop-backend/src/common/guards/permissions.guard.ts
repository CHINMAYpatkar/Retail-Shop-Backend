import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const userPermissions: string[] = user?.permissions || [];

    // SUPER_ADMIN bypasses granular permission checks
    if (user?.roleName === 'SUPER_ADMIN') {
      return true;
    }

    const hasPermission = requiredPermissions.some((p) => userPermissions.includes(p));
    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }
    return true;
  }
}
