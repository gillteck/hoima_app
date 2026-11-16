import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ownsSuspension, priorBanDuration } from "./account-suspension";

type AdminClient = SupabaseClient<Database>;

async function listAllAccounts(admin: AdminClient) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("Unable to check account access. The system remains locked.");
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  return users;
}

export async function suspendSystemAccounts(admin: AdminClient) {
  const { data: roles, error } = await admin.from("user_roles").select("user_id").eq("role", "super_admin");
  if (error) throw new Error("Unable to check account access. The system remains locked.");
  const recoveryUsers = new Set((roles ?? []).map((row) => row.user_id));
  const accounts = await listAllAccounts(admin);
  for (const user of accounts) {
    if (recoveryUsers.has(user.id)) continue;
    const { data: previous, error: readError } = await admin.from("system_lock_accounts").select("*").eq("user_id", user.id).maybeSingle();
    if (readError) throw new Error("Unable to save account access. The system remains locked.");
    if (!previous || previous.restored_at) {
      const { error: saveError } = await admin.from("system_lock_accounts").upsert({
        user_id: user.id,
        original_banned_until: user.banned_until || null,
        applied_banned_until: null,
        restored_at: null,
      });
      if (saveError) throw new Error("Unable to save account access. The system remains locked.");
    }
    if (previous?.applied_banned_until && !previous.restored_at) continue;
    // Auth API duration, not direct changes to managed auth tables.
    const { data: changed, error: banError } = await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    if (banError || !changed.user?.banned_until) throw new Error("Some sign-ins could not be suspended. The system remains locked; retry the lock action.");
    const { error: saved } = await admin.from("system_lock_accounts").update({ applied_banned_until: changed.user.banned_until }).eq("user_id", user.id);
    if (saved) throw new Error("Unable to save suspended access. The system remains locked.");
  }
}

export async function restoreSystemAccounts(admin: AdminClient) {
  const { data: snapshots, error } = await admin.from("system_lock_accounts").select("*").is("restored_at", null);
  if (error) throw new Error("Unable to restore sign-ins. The system remains locked.");
  const users = new Map((await listAllAccounts(admin)).map((user) => [user.id, user]));
  for (const snapshot of snapshots ?? []) {
    const user = users.get(snapshot.user_id);
    if (user && ownsSuspension(snapshot.applied_banned_until, user.banned_until)) {
      const { error: restoreError } = await admin.auth.admin.updateUserById(snapshot.user_id, {
        ban_duration: priorBanDuration(snapshot.original_banned_until, Date.now()),
      });
      if (restoreError) throw new Error("Some sign-ins could not be restored. The system remains locked; retry reopening.");
    }
    // If another administrator changed a restriction, do not remove it.
    const { error: saved } = await admin.from("system_lock_accounts").update({ restored_at: new Date().toISOString() }).eq("user_id", snapshot.user_id);
    if (saved) throw new Error("Unable to complete account restoration. The system remains locked.");
  }
}