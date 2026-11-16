import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSystemAccess } from "./system-access-middleware";
import { assertIsAdmin, assertIsSuperAdmin } from "@/lib/admin-auth";

const ApproveSchema = z.object({
  code: z.string().trim().min(1),
  serial_number: z.string().trim().min(1),
  assigned_officer_id: z.string().uuid().nullable().optional(),
});

export const approveDevicePairing = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => ApproveSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is an administrator
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deviceId, error } = await supabaseAdmin.rpc("approve_pairing_code_admin" as never, {
      p_caller: context.userId,
      p_code: data.code,
      p_serial_number: data.serial_number,
      p_assigned_officer_id: data.assigned_officer_id ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return { device_id: deviceId as unknown as string };
  });

const UpdateDeviceSchema = z.object({
  device_id: z.string().uuid(),
  serial_number: z.string().trim().min(1).optional(),
  imei: z.string().trim().optional().nullable(),
  model: z.string().trim().optional().nullable(),
  manufacturer: z.string().trim().optional().nullable(),
  android_version: z.string().trim().optional().nullable(),
  sim_number: z.string().trim().optional().nullable(),
  device_type: z.enum(["android_pos", "mobile_phone"]).optional(),
});

export const updateDeviceDetails = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => UpdateDeviceSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is an administrator
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Update device record with provided fields
    const updateData: Record<string, unknown> = {};
    if (data.serial_number !== undefined) updateData.serial_number = data.serial_number;
    if (data.imei !== undefined) updateData.imei = data.imei;
    if (data.model !== undefined) updateData.model = data.model;
    if (data.manufacturer !== undefined) updateData.manufacturer = data.manufacturer;
    if (data.android_version !== undefined) updateData.android_version = data.android_version;
    if (data.sim_number !== undefined) updateData.sim_number = data.sim_number;
    if (data.device_type !== undefined) updateData.device_type = data.device_type;

    const { error } = await supabaseAdmin
      .from("pos_devices")
      .update(updateData as never)
      .eq("id", data.device_id);
    
    if (error) throw new Error(error.message);
    
    return { ok: true as const };
  });

const DeleteDeviceSchema = z.object({ device_id: z.string().uuid() });

export const deleteDevice = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => DeleteDeviceSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Only super admin (AlvinRR) can delete devices
    await assertIsSuperAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Unlink from dependent tables to avoid FK issues
    await supabaseAdmin.from("payments").update({ device_id: null } as never).eq("device_id", data.device_id);
    await supabaseAdmin.from("cash_handovers").update({ device_id: null } as never).eq("device_id", data.device_id);
    await supabaseAdmin.from("device_pairing_codes").delete().eq("approved_device_id", data.device_id);

    const { error } = await supabaseAdmin.from("pos_devices").delete().eq("id", data.device_id);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
