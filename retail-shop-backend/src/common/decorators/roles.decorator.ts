import { SetMetadata } from '@nestjs/common';
import { AdminRoleName } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AdminRoleName[]) => SetMetadata(ROLES_KEY, roles);
