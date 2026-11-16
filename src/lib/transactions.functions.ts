import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSystemAccess } from "./system-access-middleware";
import { assertIsSuperAdmin } from "@/lib/admin-auth";

const TransactionRefSchema = z.object({
  transaction_id: z.string().uuid(),
  kind: z.enum(["receipt", "invoice"]),
});

/** Soft-delete a transaction (super admin only). Reversible via restoreTransaction. */
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => TransactionRefSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertIsSuperAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = data.kind === "receipt" ? "payments" : "invoices";

    const { error } = await supabaseAdmin
      .from(table)
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.transaction_id)
      .is("deleted_at", null);

    if (error) throw new Error(error.message);
    return { ok: true as const, soft_deleted: true as const };
  });

/** Restore a soft-deleted transaction (super admin only). */
export const restoreTransaction = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => TransactionRefSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertIsSuperAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = data.kind === "receipt" ? "payments" : "invoices";

    const { error } = await supabaseAdmin
      .from(table)
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", data.transaction_id);

    if (error) throw new Error(error.message);
    return { ok: true as const, restored: true as const };
  });
