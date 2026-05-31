import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. SERVER-ONLY. Never import this
// into a "use client" file or anything that ships to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );
}