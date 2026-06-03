import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import StridePlanner from "@/components/StridePlanner";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged out: simple gate (unchanged from piece 1).
  if (!user) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 32 }}>
        <h1>Stride</h1>
        <p>
          <Link href="/login">Sign in →</Link>
        </p>
      </main>
    );
  }

  // Logged in: the real app. Floating sign-out is temporary scaffolding
  // for testing — it moves into the Setup tab during piece 3.
  return (
    <>
      <StridePlanner />
      <div style={{ position: "fixed", top: 8, right: 8, zIndex: 50 }}>
        <SignOutButton />
      </div>
    </>
  );
}