import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSystemAccess } from "./system-access-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "administrator")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only administrators can perform this action");
}

const DeadlineSchema = z.object({
  officer_id: z.string().uuid(),
  deadline: z.string().datetime().nullable(),
});

export const setOfficerHandoverDeadline = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => DeadlineSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_officer_handover_deadline" as never, {
      p_officer_id: data.officer_id,
      p_deadline: data.deadline,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const ConfirmSchema = z.object({
  handover_id: z.string().uuid(),
  next_deadline: z.string().datetime().nullable(),
});

export const confirmHandover = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => ConfirmSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("confirm_handover_admin" as never, {
      p_handover_id: data.handover_id,
      p_next_deadline: data.next_deadline,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const AdminCollectSchema = z.object({
  device_id: z.string().uuid(),
  officer_id: z.string().uuid().nullable().optional(),
  actual_amount: z.number().nonnegative(),
  next_deadline: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

// Admin-initiated handover: creates the handover record on behalf of the officer
// and immediately confirms it. The confirm step resets the device cash_balance
// to 0 and unlocks it — the mobile app picks this up via Realtime on pos_devices.
export const adminCollectFromOfficer = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => AdminCollectSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up device + assigned officer + current cash balance
    const { data: dev, error: devErr } = await supabaseAdmin
      .from("pos_devices")
      .select("id, assigned_officer_id, cash_balance")
      .eq("id", data.device_id)
      .maybeSingle();
    if (devErr) throw new Error(devErr.message);
    if (!dev) throw new Error("Device not found");

    const officerId = data.officer_id || dev.assigned_officer_id;
    if (!officerId) throw new Error("Device is not assigned to an officer");

    const expected = Number(dev.cash_balance || 0);
    const actual = Number(data.actual_amount);

    // Create the handover record as admin-initiated
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("cash_handovers")
      .insert([{
        officer_id: officerId,
        device_id: data.device_id,
        opening_balance: 0,
        collected_amount: expected,
        expected_amount: expected,
        actual_amount: actual,
        difference: actual - expected,
        status: "pending",
        supervisor_id: context.userId,
        notes: data.notes || "Admin-initiated collection",
      }])
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Immediately approve — this resets device cash to 0 and unlocks it
    const { error: confirmErr } = await supabaseAdmin.rpc("confirm_handover_admin" as never, {
      p_handover_id: inserted.id,
      p_next_deadline: data.next_deadline || null,
    } as never);
    if (confirmErr) throw new Error(confirmErr.message);

    return { ok: true as const, handover_id: inserted.id, reset_amount: expected };
  });
