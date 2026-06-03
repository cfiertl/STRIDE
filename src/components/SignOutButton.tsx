"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }
  return <button onClick={signOut} style={{ padding: "8px 14px" }}>Sign out</button>;
}