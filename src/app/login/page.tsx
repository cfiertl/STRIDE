"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/");
    router.refresh();
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 320, margin: "80px auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <h1>Sign in to Stride</h1>
      <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10, fontSize: 16 }} />
      <input type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 10, fontSize: 16 }} />
      <button onClick={handleLogin} disabled={loading} style={{ padding: 10, fontSize: 16 }}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}