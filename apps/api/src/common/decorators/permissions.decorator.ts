import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pintoria/shared';

export const PERMISSIONS_KEY = 'permissions';

/** Restricts a route to users holding ANY of the given permissions. */
export const Permissions = (...required: Permission[]) => SetMetadata(PERMISSIONS_KEY, required);
