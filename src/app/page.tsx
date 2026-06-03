import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import SignOutButton from "@/components/SignOutButton";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Stride</h1>
      {user ? (
        <>
          <p>Signed in as {user.email}</p>
          <SignOutButton />
        </>
      ) : (
        <p><Link href="/login">Sign in →</Link></p>
      )}
    </main>
  );
}