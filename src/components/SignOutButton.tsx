"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }
  return (
    <button onClick={signOut} className={className} style={className ? undefined : { padding: "8px 14px" }}>
      Sign out
    </button>
  );
}