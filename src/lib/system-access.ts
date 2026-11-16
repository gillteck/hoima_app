import { z } from "zod";

export const systemAccessSchema = z.object({
  locked: z.boolean(),
  can_manage: z.boolean(),
  allowed: z.boolean(),
  session_revoked: z.boolean(),
  version: z.number().int().nonnegative(),
});

export type SystemAccess = z.infer<typeof systemAccessSchema>;

export function mustSignOut(access: SystemAccess): boolean {
  return !access.can_manage && (!access.allowed || access.session_revoked);
}

export function canUseOperations(access: SystemAccess | null): boolean {
  return Boolean(access && !access.locked && access.allowed && !access.session_revoked);
}