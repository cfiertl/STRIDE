import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
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

  // Logged in: the real app. Sign-out lives in Setup now.
  return <StridePlanner />;
}