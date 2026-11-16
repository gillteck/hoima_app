import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { systemAccessSchema, canUseOperations } from "./system-access";
import { LICENCE_EXPIRED_MESSAGE } from "./licence";

// Gate service-role entry points before any privileged reads or writes.
export const requireSystemAccess = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("get_system_access" as never);
    if (error) throw new Error("Unable to verify system access. Please try again.");
    const access = systemAccessSchema.parse(data);
    if (!canUseOperations(access)) {
      throw new Error(access.locked ? LICENCE_EXPIRED_MESSAGE : "Your session has ended. Please sign in again.");
    }
    return next();
  });