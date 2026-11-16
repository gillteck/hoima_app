// Exports every table from the OLD Supabase project by signing in as an admin.
// Run from the project root:   bun data-migration/export-old-data.mjs
// Needs two environment variables (set in the terminal, never saved in a file):
//   OLD_ADMIN_EMAIL, OLD_ADMIN_PASSWORD   (the OLD super admin's login on the old project)
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const OLD_URL = "https://iyxzqmvbefyqmegbwzgo.supabase.co";
const OLD_PUBLISHABLE_KEY = "sb_publishable_lR1FA60Pp1USD80vqHVSVA_WYl838lG";   // public key, the same one the old web app ships
const OUT = "old-data.local";              // ".local" is git-ignored by this repo

const email = process.env.OLD_ADMIN_EMAIL;
const password = process.env.OLD_ADMIN_PASSWORD;
if (!email || !password) { console.error("Set OLD_ADMIN_EMAIL and OLD_ADMIN_PASSWORD first."); process.exit(1); }

const old = createClient(OLD_URL, OLD_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { error: signErr } = await old.auth.signInWithPassword({ email, password });
if (signErr) { console.error("Sign-in to the OLD project failed:", signErr.message); process.exit(1); }

// Parents before children, the same order the import will use.
const TABLES = ["businesses", "officers", "profiles", "user_roles", "pos_devices", "invoices",
  "payments", "cash_handovers", "bank_transfers", "device_pairing_codes", "notifications",
  "audit_logs", "system_control"];

mkdirSync(OUT, { recursive: true });
for (const t of TABLES) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await old.from(t).select("*").range(from, from + 999);
    if (error) { console.error("  " + t + ": " + error.message); break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(OUT + "/" + t + ".json", JSON.stringify(rows, null, 1));
  console.log(t.padEnd(24), rows.length);
}

// Bank slip files: list what exists so we can copy them in a later step.
const { data: files, error: fErr } = await old.storage.from("bank-slips").list("", { limit: 1000 });
writeFileSync(OUT + "/_bank-slips-root-listing.json", JSON.stringify(files ?? [], null, 1));
console.log("bank-slips (top level)".padEnd(24), fErr ? fErr.message : (files ?? []).length);
console.log("\nSaved to ./" + OUT + "  (contains personal data: do NOT commit or share it)");
