// @ts-nocheck
"use client";

/* ============================================================
   THROWAWAY design-direction preview — round 2: the ENERGETIC register.
   Brief revision from user feedback: vivid saturated colour, depth &
   polish (gradients, glow, glass), personality, motivating — anchored
   on Apple Fitness / Activity. The earlier "calm" directions are dead.
   Nothing imports this route; deleted once a direction is applied.
   ============================================================ */

import React from "react";
import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer } from "recharts";

const CHART = [
  { km: 1, pace: 372, hr: 136 },
  { km: 2, pace: 365, hr: 142 },
  { km: 3, pace: 358, hr: 148 },
  { km: 4, pace: 361, hr: 151 },
  { km: 5, pace: 352, hr: 153 },
  { km: 6, pace: 349, hr: 155 },
  { km: 7, pace: 344, hr: 158 },
  { km: 8, pace: 338, hr: 162 },
];

const DIRECTIONS = [
  {
    id: "pulse",
    name: "G · Pulse",
    tagline:
      "iOS-native energy. True-dark ground, cards lifted with soft top-light, and Apple's own dark-mode signal colours doing the talking: vivid green for go, cyan and pink carrying the data. The closest to opening Apple Fitness.",
    extras: "Charts: cyan pace + pink HR · route line vivid green · CARTO dark tiles · triad = iOS green/yellow/red",
    tokens: {
      "--bg": "#0a0a0c",
      "--panel": "#1b1b20",
      "--panel-2": "#2a2a31",
      "--line": "#36363f",
      "--ink": "#f5f5f7",
      "--muted": "#9a9aa2",
      "--accent": "#32d74b",
      "--accent-dim": "#28a83c",
      "--coral": "#ff453a",
      "--amber": "#ffd60a",
      "--on-accent": "#04130a",
      "--viz-a": "#64d2ff",
      "--viz-b": "#ff375f",
    },
    glow: "radial-gradient(900px 480px at 75% -15%, rgba(50,215,75,0.16) 0%, transparent 60%)",
    cardFx: "linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0) 45%)",
    btnGlow: "0 6px 22px rgba(50,215,75,0.38)",
    glass: false,
    triad: [
      ["Positive", "#32d74b"],
      ["Caution", "#ffd60a"],
      ["Negative", "#ff453a"],
    ],
  },
  {
    id: "neondusk",
    name: "H · Neon Dusk",
    tagline:
      "Recovery-tech premium. Deep indigo night, glassy translucent cards, and an iridescent coral→violet gradient that lives in the hero ring, the primary button and the big numerals. Glowing, nocturnal, a bit indulgent.",
    extras: "Charts: teal pace + coral HR · route line gradient-coral · CARTO dark tiles · triad = teal/amber/coral",
    tokens: {
      "--bg": "#0d0d16",
      "--panel": "#181826",
      "--panel-2": "#232336",
      "--line": "#32324a",
      "--ink": "#f2f1fa",
      "--muted": "#9695ad",
      "--accent": "#ff6d7f",
      "--accent-dim": "#c44e68",
      "--coral": "#fb5560",
      "--amber": "#fbbf24",
      "--on-accent": "#1c0a10",
      "--viz-a": "#2dd4bf",
      "--viz-b": "#a78bfa",
    },
    glow: "radial-gradient(1000px 520px at 20% -15%, rgba(167,139,250,0.20) 0%, transparent 58%), radial-gradient(800px 420px at 95% 10%, rgba(255,109,127,0.13) 0%, transparent 55%)",
    cardFx: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 50%)",
    btnGrad: "linear-gradient(95deg, #ff6d7f 0%, #c86dd7 55%, #8a7bff 100%)",
    btnGlow: "0 6px 26px rgba(200,109,215,0.45)",
    glass: true,
    triad: [
      ["Positive", "#2dd4bf"],
      ["Caution", "#fbbf24"],
      ["Negative", "#fb5560"],
    ],
  },
  {
    id: "court",
    name: "I · Court",
    tagline:
      "Energetic light. Bright white ground, electric cobalt as the franchise colour, and tinted card fills instead of grey boxes — the Apple Health light-mode trick. Punchy, daylight-friendly, big confident numerals.",
    extras: "Charts: cobalt pace + orange HR · route line cobalt · CARTO light tiles · triad = green/orange/red",
    tokens: {
      "--bg": "#f6f7fb",
      "--panel": "#ffffff",
      "--panel-2": "#eef1fb",
      "--line": "#e3e7f2",
      "--ink": "#15192b",
      "--muted": "#697086",
      "--accent": "#2451ff",
      "--accent-dim": "#1c40cc",
      "--coral": "#ef4444",
      "--amber": "#f59e0b",
      "--on-accent": "#ffffff",
      "--viz-a": "#2451ff",
      "--viz-b": "#ff7d2e",
    },
    glow: "radial-gradient(900px 480px at 80% -15%, rgba(36,81,255,0.10) 0%, transparent 60%)",
    cardFx: "none",
    btnGlow: "0 8px 24px rgba(36,81,255,0.35)",
    cardShadow: "0 2px 14px rgba(21,25,43,0.07)",
    glass: false,
    triad: [
      ["Positive", "#16a34a"],
      ["Caution", "#f59e0b"],
      ["Negative", "#ef4444"],
    ],
  },
];

const NAV = [
  ["plan", "Plan"],
  ["activity", "Activities"],
  ["today", "Today"],
  ["fuel", "Fuel"],
  ["insights", "Insights"],
];

const NavGlyph = ({ id }) => {
  const paths = {
    plan: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    fuel: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
    insights: <path d="M5 20V12M12 20V4M19 20v-6" />,
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
};

/* Activity-ring hero: progress ring with a gradient stroke. */
function Ring({ t, pct = 0.72 }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const gid = `ring-${t.id}`;
  return (
    <svg width="116" height="116" viewBox="0 0 116 116">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={t.tokens["--viz-a"]} />
          <stop offset="100%" stopColor={t.tokens["--accent"]} />
        </linearGradient>
      </defs>
      <circle cx="58" cy="58" r={r} fill="none" stroke={t.tokens["--line"]} strokeWidth="11" opacity="0.55" />
      <circle
        cx="58" cy="58" r={r} fill="none"
        stroke={`url(#${gid})`} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 58 58)"
        style={{ filter: `drop-shadow(0 0 7px color-mix(in srgb, ${t.tokens["--accent"]} 55%, transparent))` }}
      />
      <text x="58" y="54" textAnchor="middle" fill={t.tokens["--ink"]} fontSize="21" fontWeight="800">24.5</text>
      <text x="58" y="71" textAnchor="middle" fill={t.tokens["--muted"]} fontSize="10" letterSpacing="0.6">OF 34 KM</text>
    </svg>
  );
}

function Slice({ t }) {
  return (
    <section
      className={`dp-theme ${t.glass ? "dp-glass" : ""}`}
      style={{
        ...t.tokens,
        "--glowbg": t.glow,
        "--cardfx": t.cardFx,
        "--btn-glow": t.btnGlow || "none",
        "--btn-bg": t.btnGrad || "var(--accent)",
        "--card-shadow": t.cardShadow || "0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      <div className="dp-head">
        <h2>{t.name}</h2>
        <p className="dp-tagline">{t.tagline}</p>
        <div className="dp-triad">
          {t.triad.map(([label, hex]) => (
            <span key={label} className="dp-swatch"><i style={{ background: hex }} />{label} <code>{hex}</code></span>
          ))}
        </div>
      </div>

      <div className="dp-topbar">
        <span className="dp-brand">STRIDE<span className="dp-dot">.</span></span>
        <span className="dp-avatar">C</span>
      </div>

      {/* hero: ring + stats */}
      <div className="dp-card dp-hero">
        <Ring t={t} />
        <div className="dp-herostats">
          <div><span className="dp-num" style={{ color: t.tokens["--viz-a"] }}>4:52</span><label>Avg pace</label></div>
          <div><span className="dp-num" style={{ color: t.tokens["--accent"] }}>3/4</span><label>Sessions</label></div>
          <div><span className="dp-num" style={{ color: t.tokens["--viz-b"] }}>156</span><label>Avg HR</label></div>
        </div>
      </div>

      {/* session + pills + buttons */}
      <div className="dp-card">
        <div className="dp-session">
          <span className="dp-day">Thu</span>
          <span className="dp-sessionbody">
            <strong>Tempo / Threshold</strong>
            <em>2km easy · 4 × 1.5km @ 4:35 · 2km easy</em>
          </span>
          <span className="dp-pill dp-pill-hard">quality</span>
        </div>
        <div className="dp-pillrow">
          <span className="dp-pill dp-pill-accent" style={{ "--pc": t.triad[0][1] }}>Good run · 8/10</span>
          <span className="dp-pill dp-pill-warn" style={{ "--pc": t.triad[1][1] }}>Cutback week</span>
          <span className="dp-pill dp-pill-bad" style={{ "--pc": t.triad[2][1] }}>Pain flag · knee</span>
        </div>
        <div className="dp-btnrow">
          <button className="dp-btn-primary">＋ Log a run</button>
          <button className="dp-btn-ghost">View pace history</button>
        </div>
      </div>

      {/* chart */}
      <div className="dp-card">
        <div className="dp-cardhead"><h3>Pace · last 8km</h3><span className="dp-muted">4:38/km</span></div>
        <div style={{ height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={CHART} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="km" hide />
              <YAxis yAxisId="pace" hide reversed domain={["dataMin - 10", "dataMax + 10"]} />
              <YAxis yAxisId="hr" hide domain={[120, 180]} />
              <Area yAxisId="hr" dataKey="hr" type="monotone" fill={t.tokens["--viz-b"]} stroke="none" fillOpacity={0.16} />
              <Line yAxisId="pace" dataKey="pace" type="monotone" stroke={t.tokens["--viz-a"]} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="dp-legend">
          <span><i style={{ background: t.tokens["--viz-a"] }} /> pace</span>
          <span><i style={{ background: t.tokens["--viz-b"], opacity: 0.6 }} /> heart rate</span>
        </div>
      </div>

      {/* tab bar */}
      <div className="dp-nav">
        {NAV.map(([id, label]) => (
          <span key={id} className={`dp-navitem ${id === "today" ? "dp-navactive" : ""}`}>
            {id === "today" ? <span className="dp-navdate">12</span> : <NavGlyph id={id} />}
            <span className="dp-navlabel">{label}</span>
          </span>
        ))}
      </div>

      <p className="dp-extras">{t.extras}</p>

      <details className="dp-tokens">
        <summary>Full token map</summary>
        <div className="dp-tokengrid">
          {Object.entries(t.tokens).map(([k, v]) => (
            <span key={k} className="dp-token"><i style={{ background: v }} /><code>{k}</code><code className="dp-muted">{v}</code></span>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function DesignPreview() {
  return (
    <main className="dp-page">
      <style>{CSS}</style>
      <header className="dp-pagehead">
        <h1>STRIDE — round 2: energetic directions</h1>
        <p>Vivid colour, depth, personality — anchored on Apple Fitness. Type stays Figtree. Pick one, or a mix.</p>
      </header>
      {DIRECTIONS.map((t) => <Slice key={t.id} t={t} />)}
    </main>
  );
}

const CSS = `
  .dp-page { background:#08080a; min-height:100vh; margin:0 auto; padding:24px 0 80px; font-family:var(--font-body), system-ui, sans-serif; }
  .dp-pagehead { max-width:560px; margin:0 auto 28px; padding:0 22px; color:#e8e8ec; }
  .dp-pagehead h1 { font-size:20px; margin:0 0 6px; }
  .dp-pagehead p { font-size:13px; color:#8f8f99; margin:0; line-height:1.5; }

  .dp-theme { max-width:560px; margin:0 auto 36px; padding:26px 22px 30px; position:relative; overflow:hidden;
    background:var(--bg); background-image:var(--glowbg); color:var(--ink); border-radius:26px; }

  .dp-head h2 { font-size:24px; font-weight:800; margin:0 0 8px; letter-spacing:-0.02em; }
  .dp-tagline { font-size:13.5px; color:var(--muted); line-height:1.55; margin:0 0 12px; }
  .dp-triad { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:18px; }
  .dp-swatch { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:var(--muted); }
  .dp-swatch i { width:14px; height:14px; border-radius:5px; display:inline-block; }
  .dp-swatch code { font-size:10.5px; }

  .dp-topbar { display:flex; align-items:center; justify-content:space-between; padding:4px 2px 14px; }
  .dp-brand { font-weight:800; font-size:23px; letter-spacing:-0.03em; }
  .dp-dot { color:var(--accent); }
  .dp-avatar { width:32px; height:32px; border-radius:50%; background:var(--panel-2); border:1px solid var(--line);
    display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; }

  .dp-card { background:var(--panel); background-image:var(--cardfx); border:1px solid var(--line);
    border-radius:18px; padding:16px; margin-bottom:12px; box-shadow:var(--card-shadow); }
  .dp-glass .dp-card { background:color-mix(in srgb, var(--panel) 72%, transparent); backdrop-filter:blur(14px); }
  .dp-hero { display:flex; align-items:center; gap:16px; }
  .dp-herostats { display:flex; flex-direction:column; gap:10px; flex:1; }
  .dp-herostats > div { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
  .dp-num { font-size:23px; font-weight:800; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
  .dp-herostats label { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.07em; }
  .dp-cardhead { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
  .dp-cardhead h3 { font-size:15px; font-weight:700; margin:0; }

  .dp-session { display:flex; align-items:center; gap:12px; background:color-mix(in srgb, var(--bg) 55%, var(--panel));
    border:1px solid var(--line); border-radius:13px; padding:12px; margin-bottom:12px; }
  .dp-day { font-size:12px; color:var(--accent); width:34px; font-weight:800; font-variant-numeric:tabular-nums; }
  .dp-sessionbody { flex:1; display:flex; flex-direction:column; gap:3px; }
  .dp-sessionbody strong { font-size:14px; }
  .dp-sessionbody em { font-style:normal; font-size:12.5px; color:var(--muted); }

  .dp-pill { font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; white-space:nowrap;
    color:var(--pc); background:color-mix(in srgb, var(--pc) 16%, transparent); border:1px solid color-mix(in srgb, var(--pc) 36%, transparent); }
  .dp-pill-hard { --pc: var(--coral); }
  .dp-pillrow { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }

  .dp-btnrow { display:flex; gap:10px; align-items:center; }
  .dp-btn-primary { background:var(--btn-bg); color:var(--on-accent); border:none; border-radius:13px; padding:13px 20px;
    font-family:inherit; font-weight:800; font-size:14px; cursor:pointer; box-shadow:var(--btn-glow); }
  .dp-btn-ghost { background:transparent; border:1px solid var(--line); color:var(--ink); border-radius:11px;
    padding:11px 14px; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; }

  .dp-muted { color:var(--muted); font-size:13px; font-variant-numeric:tabular-nums; }
  .dp-legend { display:flex; gap:16px; margin-top:8px; font-size:11.5px; color:var(--muted); }
  .dp-legend i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }

  .dp-nav { display:flex; background:color-mix(in srgb, var(--panel) 88%, transparent); border:1px solid var(--line);
    border-radius:16px; padding:7px 4px; backdrop-filter:blur(10px); box-shadow:var(--card-shadow); }
  .dp-navitem { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:5px 2px 3px; color:var(--muted); }
  .dp-navactive { color:var(--accent); }
  .dp-navactive svg, .dp-navactive .dp-navdate { filter:drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 60%, transparent)); }
  .dp-navlabel { font-size:9.5px; font-weight:700; letter-spacing:0.02em; }
  .dp-navdate { font-size:11px; font-weight:800; line-height:1; width:20px; height:20px; font-variant-numeric:tabular-nums;
    display:inline-flex; align-items:center; justify-content:center; border:1.5px solid currentColor; border-radius:6px; }

  .dp-extras { font-size:11.5px; color:var(--muted); margin:14px 2px 6px; line-height:1.5; }
  .dp-tokens summary { font-size:12px; color:var(--muted); cursor:pointer; }
  .dp-tokengrid { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; padding:10px 2px; }
  .dp-token { display:inline-flex; align-items:center; gap:7px; font-size:11px; }
  .dp-token i { width:13px; height:13px; border-radius:4px; border:1px solid var(--line); flex-shrink:0; }
  .dp-token code { font-size:10.5px; }
`;
