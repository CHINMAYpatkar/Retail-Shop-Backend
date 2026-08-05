import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects routes intended for authenticated ADMIN CMS users.
 * Uses the 'jwt-admin' passport strategy registered in AuthModule.
 */
@Injectable()
export class JwtAdminAuthGuard extends AuthGuard('jwt-admin') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
