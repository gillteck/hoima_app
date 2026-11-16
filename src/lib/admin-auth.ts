/**
 * Admin authorization utilities for server functions
 */

async function fetchRoles(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { role: string }) => r.role);
}

export async function assertIsAdmin(supabase: any, userId: string) {
  const roles = await fetchRoles(supabase, userId);
  if (!roles.some((r) => r === "administrator" || r === "super_admin")) {
    throw new Error("Only administrators can perform this action");
  }
}

export async function assertIsSuperAdmin(supabase: any, userId: string) {
  const roles = await fetchRoles(supabase, userId);
  if (!roles.includes("super_admin")) {
    throw new Error("Only super administrators can perform this action");
  }
}

export async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  try {
    const roles = await fetchRoles(supabase, userId);
    return roles.some((r) => r === "administrator" || r === "super_admin");
  } catch {
    return false;
  }
}

export async function isSuperAdmin(supabase: any, userId: string): Promise<boolean> {
  try {
    const roles = await fetchRoles(supabase, userId);
    return roles.includes("super_admin");
  } catch {
    return false;
  }
}
