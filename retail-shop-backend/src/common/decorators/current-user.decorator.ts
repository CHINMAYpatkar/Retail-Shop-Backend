import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the authenticated principal attached to the request by the JWT strategy.
 * Works for both customer and admin guards, since both attach `req.user`.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
