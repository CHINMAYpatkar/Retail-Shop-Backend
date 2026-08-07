import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects routes intended for authenticated CUSTOMERS (storefront).
 * Uses the 'jwt-customer' passport strategy registered in AuthModule.
 */
@Injectable()
export class JwtCustomerAuthGuard extends AuthGuard('jwt-customer') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
