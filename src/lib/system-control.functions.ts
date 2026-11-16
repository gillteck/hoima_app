import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { systemAccessSchema } from "./system-access";

export const setSystemLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ locked: z.boolean(), expected_version: z.number().int().nonnegative() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: current, error: accessError } = await context.supabase.rpc("get_system_access");
    if (accessError) throw new Error("Unable to verify system access.");
    const access = systemAccessSchema.parse(current);
    if (!access.can_manage) throw new Error("Not authorized");
    if (access.version !== data.expected_version) throw new Error("System access changed. Refresh and try again.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { suspendSystemAccounts, restoreSystemAccounts } = await import("./system-login-lock.server");
    const setState = async (locked: boolean) => {
      const { error } = await supabaseAdmin.rpc("set_system_lock_service", {
        p_caller: context.userId, p_locked: locked, p_expected_version: data.expected_version,
      });
      if (error) throw new Error(error.message);
    };
    if (data.locked) {
      // Deny operational reads/writes first; then suspend password/refresh sign-ins.
      await setState(true);
      await suspendSystemAccounts(supabaseAdmin);
    } else {
      // Keep operational access closed until every owned suspension is restored.
      await restoreSystemAccounts(supabaseAdmin);
      await setState(false);
    }
    const { data: result, error } = await context.supabase.rpc("get_system_access");
    if (error) throw new Error("Unable to refresh system access.");
    return systemAccessSchema.parse(result);
  });