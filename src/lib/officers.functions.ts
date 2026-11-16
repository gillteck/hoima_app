import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSystemAccess } from "./system-access-middleware";
import { assertIsAdmin } from "@/lib/admin-auth";

const CreateSchema = z.object({
  username: z.string().trim().min(2).regex(/^[a-zA-Z0-9._-]+$/, "Letters, digits, . _ - only"),
  password: z.string().min(6),
  employee_id: z.string().trim().min(1),
  full_name: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  division: z.string().trim().optional().nullable(),
  collection_area: z.string().trim().optional().nullable(),
  monthly_target: z.number().nonnegative().optional(),
  role: z.enum(["administrator", "supervisor", "revenue_officer"]).default("revenue_officer"),
});

export const createOfficerAccount = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => CreateSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is an administrator
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = `${data.username.toLowerCase()}@hoima.gov`;

    // Create the auth user (email pre-confirmed so officer can sign in immediately)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username: data.username, full_name: data.full_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message || "Failed to create user");

    const newUserId = created.user.id;

    // handle_new_user() trigger auto-creates profile + default role.
    // Upsert the officer row and link it to the new auth user.
    const { error: offErr } = await supabaseAdmin
      .from("officers")
      .upsert(
        {
          user_id: newUserId,
          employee_id: data.employee_id,
          full_name: data.full_name,
          email,
          phone: data.phone ?? null,
          division: data.division ?? null,
          collection_area: data.collection_area ?? null,
          monthly_target: data.monthly_target ?? 0,
          status: "active",
        },
        { onConflict: "employee_id" },
      );
    if (offErr) {
      // Roll back auth user if officer row failed
      await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
      throw new Error(offErr.message);
    }

    // Ensure the requested role is set (override the trigger's default if needed)
    if (data.role !== "revenue_officer") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
      const { error: rErr } = await supabaseAdmin
        .from("user_roles")
        .insert([{ user_id: newUserId, role: data.role }]);
      if (rErr) throw new Error(rErr.message);
    }

    return { ok: true as const, user_id: newUserId, email };
  });

const UpdateSchema = z.object({
  officer_id: z.string().uuid(),
  full_name: z.string().trim().min(1).optional(),
  phone: z.string().trim().optional().nullable(),
  division: z.string().trim().optional().nullable(),
  collection_area: z.string().trim().optional().nullable(),
  monthly_target: z.number().nonnegative().optional(),
});

export const updateOfficerDetails = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => UpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is an administrator
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Update officer record with provided fields
    const updateData: Record<string, unknown> = {};
    if (data.full_name !== undefined) updateData.full_name = data.full_name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.division !== undefined) updateData.division = data.division;
    if (data.collection_area !== undefined) updateData.collection_area = data.collection_area;
    if (data.monthly_target !== undefined) updateData.monthly_target = data.monthly_target;

    const { error } = await supabaseAdmin
      .from("officers")
      .update(updateData as never)
      .eq("id", data.officer_id);
    
    if (error) throw new Error(error.message);
    
    return { ok: true as const };
  });

const ResetPasswordSchema = z.object({
  officer_id: z.string().uuid(),
});

// Generate random password
function generatePassword(length: number = 12): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export const resetOfficerPassword = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => ResetPasswordSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is an administrator
    await assertIsAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Get the officer to find their user_id
    const { data: officer, error: offErr } = await supabaseAdmin
      .from("officers")
      .select("user_id, email")
      .eq("id", data.officer_id)
      .maybeSingle();
    
    if (offErr) throw new Error(offErr.message);
    if (!officer || !officer.user_id) throw new Error("Officer not found");

    // Generate new password
    const newPassword = generatePassword();

    // Update the auth user's password
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
      officer.user_id,
      { password: newPassword }
    );
    
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true as const, password: newPassword, email: officer.email };
  });

export const deleteOfficer = createServerFn({ method: "POST" })
  .middleware([requireSystemAccess])
  .inputValidator((data: unknown) => z.object({ officer_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertIsAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: off, error } = await supabaseAdmin
      .from("officers").select("user_id").eq("id", data.officer_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!off) throw new Error("Officer not found");
    const id = data.officer_id;
    await supabaseAdmin.from("payments").update({ officer_id: null } as never).eq("officer_id", id);
    await supabaseAdmin.from("bank_transfers").update({ officer_id: null } as never).eq("officer_id", id);
    await supabaseAdmin.from("cash_handovers").update({ officer_id: null } as never).eq("officer_id", id);
    await supabaseAdmin.from("pos_devices").update({ assigned_officer_id: null } as never).eq("assigned_officer_id", id);
    await supabaseAdmin.from("device_pairing_codes").update({ requested_by_officer_id: null } as never).eq("requested_by_officer_id", id);
    const { error: dErr } = await supabaseAdmin.from("officers").delete().eq("id", id);
    if (dErr) throw new Error(dErr.message);
    if (off.user_id) await supabaseAdmin.auth.admin.deleteUser(off.user_id).catch(() => {});
    return { ok: true as const };
  });
