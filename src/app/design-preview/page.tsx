// @ts-nocheck
"use client";

/* ============================================================
   Pass 2 / Phase A — THROWAWAY design-direction preview.
   Three candidate themes rendered on a representative slice
   (card, hero stats, pills, buttons, chart, tab bar, toast).
   Nothing imports this route and StridePlanner.tsx is untouched.
   Delete this folder once a direction is chosen and applied.
   ============================================================ */

import React from "react";
import {
  Fraunces,
  Albert_Sans,
  Spline_Sans_Mono,
  Gabarito,
  Instrument_Sans,
  IBM_Plex_Mono,
  Space_Grotesk,
  Space_Mono,
  Archivo,
  JetBrains_Mono,
  Inter,
  Inter_Tight,
} from "next/font/google";
import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer } from "recharts";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--dp-fraunces" });
const albert = Albert_Sans({ subsets: ["latin"], variable: "--dp-albert" });
const spline = Spline_Sans_Mono({ subsets: ["latin"], variable: "--dp-spline" });
const gabarito = Gabarito({ subsets: ["latin"], variable: "--dp-gabarito" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--dp-instrument" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--dp-plex" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--dp-spacegrotesk" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--dp-spacemono" });
const archivo = Archivo({ subsets: ["latin"], variable: "--dp-archivo" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--dp-jetbrains" });
const inter = Inter({ subsets: ["latin"], variable: "--dp-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--dp-intertight" });

/* Dummy pace/HR data for the chart slice. */
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
    id: "daybreak",
    name: "A · Daybreak",
    tagline:
      "Warm light, editorial. Paper ground, ink text, deep pine accent — a morning journal that happens to know your splits. Built for being opened at dawn.",
    typeNote: "Fraunces (display, 600) · Albert Sans (body, 400/600) · Spline Sans Mono (numerals, 400/500)",
    extras: "Leaflet → CARTO light (positron) tiles · route line pine · chart series pine + clay on white",
    tokens: {
      "--bg": "#f6f1e7",
      "--panel": "#fffdf8",
      "--panel-2": "#eee6d6",
      "--line": "#e2d8c3",
      "--ink": "#272218",
      "--muted": "#7f7666",
      "--accent": "#4a6b57",
      "--accent-dim": "#71907e",
      "--coral": "#b4543e",
      "--amber": "#a87b24",
      "--on-accent": "#f8f5ec",
    },
    glow: "#fbf6ea",
    fonts: {
      display: "var(--dp-fraunces), Georgia, serif",
      body: "var(--dp-albert), system-ui, sans-serif",
      mono: "var(--dp-spline), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#4a6b57"],
      ["Caution", "#a87b24"],
      ["Negative", "#b4543e"],
    ],
  },
  {
    id: "ember",
    name: "B · Ember",
    tagline:
      "Warm dark, lantern-lit. Brown-black ground, soft gold accent, rounded geometric display. The calm-dark cousin of the current theme — same night mode, none of the energy drink.",
    typeNote: "Gabarito (display, 600/700) · Instrument Sans (body, 400/600) · IBM Plex Mono (numerals, 400/500)",
    extras: "Leaflet → keep CARTO dark tiles · route line gold · chart series gold + ember on warm black",
    tokens: {
      "--bg": "#161310",
      "--panel": "#1f1a14",
      "--panel-2": "#28211a",
      "--line": "#382f23",
      "--ink": "#ece4d4",
      "--muted": "#9a8f7b",
      "--accent": "#dfba6f",
      "--accent-dim": "#b59252",
      "--coral": "#c25649",
      "--amber": "#c87e3e",
      "--on-accent": "#211a10",
    },
    glow: "#221c14",
    fonts: {
      display: "var(--dp-gabarito), system-ui, sans-serif",
      body: "var(--dp-instrument), system-ui, sans-serif",
      mono: "var(--dp-plex), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#dfba6f"],
      ["Caution", "#c87e3e"],
      ["Negative", "#c25649"],
    ],
  },
  {
    id: "meridian",
    name: "C · Meridian",
    tagline:
      "Cool graphite, instrument-grade. Flat hairline surfaces, glacier-blue accent, mono everywhere numbers live. Data-forward: the chrome recedes, the readings carry the design.",
    typeNote: "Geist (display, 600 / body, 400) · Geist Mono (numerals, 400/500) — both already in the project",
    extras: "Leaflet → keep CARTO dark tiles · route line glacier · chart series glacier + rust on graphite",
    tokens: {
      "--bg": "#0f1115",
      "--panel": "#161920",
      "--panel-2": "#1d212b",
      "--line": "#2a303d",
      "--ink": "#e6e9ef",
      "--muted": "#8c93a2",
      "--accent": "#8fb6cd",
      "--accent-dim": "#5f8499",
      "--coral": "#d07262",
      "--amber": "#d3a85c",
      "--on-accent": "#0c141b",
    },
    glow: "#141821",
    fonts: {
      display: "var(--font-geist-sans), system-ui, sans-serif",
      body: "var(--font-geist-sans), system-ui, sans-serif",
      mono: "var(--font-geist-mono), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#8fb6cd"],
      ["Caution", "#d3a85c"],
      ["Negative", "#d07262"],
    ],
  },
  {
    id: "fieldnote",
    name: "D · Fieldnote",
    tagline:
      "Calm-tech monochrome, e-ink register. Grey-white paper, ink as the accent — colour appears ONLY as information: a good week is quiet, a pain flag is the loudest thing on screen. The most radical read on “calm.”",
    typeNote: "Space Grotesk (display, 600 / body, 400) · Space Mono (numerals, 400/700)",
    extras: "Leaflet → CARTO light tiles · route line ink · chart = single ink line, red reserved for pain markers",
    tokens: {
      "--bg": "#e9e7e1",
      "--panel": "#f5f4ef",
      "--panel-2": "#dfdcd3",
      "--line": "#c8c4b8",
      "--ink": "#21201c",
      "--muted": "#6e6b61",
      "--accent": "#21201c",
      "--accent-dim": "#57544b",
      "--coral": "#b3402e",
      "--amber": "#a06b1e",
      "--on-accent": "#f5f4ef",
    },
    glow: "#f1efe9",
    fonts: {
      display: "var(--dp-spacegrotesk), system-ui, sans-serif",
      body: "var(--dp-spacegrotesk), system-ui, sans-serif",
      mono: "var(--dp-spacemono), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#21201c"],
      ["Caution", "#a06b1e"],
      ["Negative", "#b3402e"],
    ],
  },
  {
    id: "cockpit",
    name: "E · Cockpit",
    tagline:
      "True-black AMOLED instrument. Pure #000 ground (OLED battery + dawn-friendly), warm-white readouts, aviation annunciator triad — green is good, amber advises, red warns. Designed dark-first, not inverted.",
    typeNote: "Archivo (display, 600 / body, 400) · JetBrains Mono (numerals — the app's current mono, kept)",
    extras: "Leaflet → keep CARTO dark tiles · route line phosphor green · chart series green + red on black, faint grid like a gauge face",
    tokens: {
      "--bg": "#000000",
      "--panel": "#0e0f10",
      "--panel-2": "#17181b",
      "--line": "#27292e",
      "--ink": "#eae8e1",
      "--muted": "#87847b",
      "--accent": "#7fae74",
      "--accent-dim": "#5d8455",
      "--coral": "#d4543e",
      "--amber": "#d29a3a",
      "--on-accent": "#0a0d09",
    },
    glow: "#101210",
    fonts: {
      display: "var(--dp-archivo), system-ui, sans-serif",
      body: "var(--dp-archivo), system-ui, sans-serif",
      mono: "var(--dp-jetbrains), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#7fae74"],
      ["Caution", "#d29a3a"],
      ["Negative", "#d4543e"],
    ],
  },
  {
    id: "helvetic",
    name: "F · Helvetic",
    tagline:
      "Swiss / International cool light. Neutral grey-white ground, graphite ink, hard hairlines, one restrained ultramarine accent. Hierarchy comes from type scale and grid, never from decoration. The cool-light slot A doesn't cover.",
    typeNote: "Inter Tight (display, 700, tight tracking) · Inter (body, 400/600) · IBM Plex Mono (numerals, 400/500)",
    extras: "Leaflet → CARTO light tiles · route line ultramarine · chart series ultramarine + signal red on white",
    tokens: {
      "--bg": "#f2f3f3",
      "--panel": "#fbfbfb",
      "--panel-2": "#e8eaea",
      "--line": "#d8dbdb",
      "--ink": "#181b1d",
      "--muted": "#6c7276",
      "--accent": "#3f5d9d",
      "--accent-dim": "#6f87b8",
      "--coral": "#b23b32",
      "--amber": "#a4761c",
      "--on-accent": "#f5f7fa",
    },
    glow: "#f8f9f9",
    fonts: {
      display: "var(--dp-intertight), system-ui, sans-serif",
      body: "var(--dp-inter), system-ui, sans-serif",
      mono: "var(--dp-plex), ui-monospace, monospace",
    },
    triad: [
      ["Positive", "#3f5d9d"],
      ["Caution", "#a4761c"],
      ["Negative", "#b23b32"],
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

function Slice({ t }) {
  const accent = t.tokens["--accent"];
  const coral = t.tokens["--coral"];
  const muted = t.tokens["--muted"];
  return (
    <section
      className="dp-theme"
      style={{
        ...t.tokens,
        "--font-display": t.fonts.display,
        "--font-body": t.fonts.body,
        "--font-mono": t.fonts.mono,
        "--glow": t.glow,
      }}
    >
      <div className="dp-head">
        <h2>{t.name}</h2>
        <p className="dp-tagline">{t.tagline}</p>
        <p className="dp-typenote">{t.typeNote}</p>
        <div className="dp-triad">
          {t.triad.map(([label, hex]) => (
            <span key={label} className="dp-swatch">
              <i style={{ background: hex }} />
              {label} <code>{hex}</code>
            </span>
          ))}
        </div>
      </div>

      {/* topbar slice */}
      <div className="dp-topbar">
        <span className="dp-brand">STRIDE<span className="dp-dot">.</span></span>
        <span className="dp-avatar">C</span>
      </div>

      {/* hero card */}
      <div className="dp-card dp-hero">
        <div className="dp-cardhead">
          <h3>This week</h3>
          <span className="dp-pill dp-pill-accent">on plan</span>
        </div>
        <div className="dp-statrow">
          <div className="dp-stat"><div className="dp-statval dp-accent">24.5<small>km</small></div><div className="dp-statlabel">Volume</div></div>
          <div className="dp-stat"><div className="dp-statval">4:52</div><div className="dp-statlabel">Avg pace</div></div>
          <div className="dp-stat"><div className="dp-statval">3/4</div><div className="dp-statlabel">Sessions</div></div>
        </div>
      </div>

      {/* session row + pills */}
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
          <span className="dp-pill dp-pill-accent">Good run · 8/10</span>
          <span className="dp-pill dp-pill-warn">Cutback week</span>
          <span className="dp-pill dp-pill-hard">Pain flag · knee</span>
        </div>
        <div className="dp-btnrow">
          <button className="dp-btn-primary">＋ Log a run</button>
          <button className="dp-btn-ghost">View pace history</button>
        </div>
      </div>

      {/* chart card */}
      <div className="dp-card">
        <div className="dp-cardhead">
          <h3>Pace · last 8km</h3>
          <span className="dp-mono dp-muted">4:38/km</span>
        </div>
        <div style={{ height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={CHART} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="km" hide />
              <YAxis yAxisId="pace" hide reversed domain={["dataMin - 10", "dataMax + 10"]} />
              <YAxis yAxisId="hr" hide domain={[120, 180]} />
              <Area yAxisId="hr" dataKey="hr" type="monotone" fill={coral} stroke="none" fillOpacity={0.12} />
              <Line yAxisId="pace" dataKey="pace" type="monotone" stroke={accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="dp-legend">
          <span><i style={{ background: accent }} /> pace</span>
          <span><i style={{ background: coral, opacity: 0.5 }} /> heart rate</span>
        </div>
      </div>

      {/* toast slice */}
      <div className="dp-toast">
        <span>Paces updated from your 10km — about 4% quicker.</span>
        <button className="dp-link">View</button>
      </div>

      {/* tab bar slice */}
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
    <main className={`dp-page ${fraunces.variable} ${albert.variable} ${spline.variable} ${gabarito.variable} ${instrument.variable} ${plexMono.variable} ${spaceGrotesk.variable} ${spaceMono.variable} ${archivo.variable} ${jetbrains.variable} ${inter.variable} ${interTight.variable}`}>
      <style>{CSS}</style>
      <header className="dp-pagehead">
        <h1>STRIDE — Pass 2 design directions</h1>
        <p>Six candidates on the same representative slice. Scroll, compare, pick one (or a mix). Throwaway route — the real app is untouched.</p>
      </header>
      {DIRECTIONS.map((t) => <Slice key={t.id} t={t} />)}
    </main>
  );
}

const CSS = `
  .dp-page { background:#08090a; min-height:100vh; margin:0 auto; padding:24px 0 80px; }
  .dp-pagehead { max-width:560px; margin:0 auto 28px; padding:0 22px; color:#d7dad6; font-family:system-ui, sans-serif; }
  .dp-pagehead h1 { font-size:20px; margin:0 0 6px; }
  .dp-pagehead p { font-size:13px; color:#8b918c; margin:0; line-height:1.5; }

  .dp-theme { max-width:560px; margin:0 auto 36px; padding:26px 22px 30px;
    background: radial-gradient(700px 360px at 80% -10%, var(--glow) 0%, var(--bg) 55%);
    color:var(--ink); font-family:var(--font-body); border-radius:24px; }

  .dp-head h2 { font-family:var(--font-display); font-size:24px; margin:0 0 8px; letter-spacing:-0.02em; }
  .dp-tagline { font-size:13.5px; color:var(--muted); line-height:1.55; margin:0 0 6px; }
  .dp-typenote { font-size:12px; color:var(--muted); margin:0 0 12px; }
  .dp-triad { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:20px; }
  .dp-swatch { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:var(--muted); }
  .dp-swatch i { width:14px; height:14px; border-radius:4px; display:inline-block; }
  .dp-swatch code { font-family:var(--font-mono); font-size:10.5px; }

  .dp-topbar { display:flex; align-items:center; justify-content:space-between; padding:4px 2px 14px; }
  .dp-brand { font-family:var(--font-display); font-weight:700; font-size:22px; letter-spacing:-0.03em; }
  .dp-dot { color:var(--accent); }
  .dp-avatar { width:32px; height:32px; border-radius:50%; background:var(--panel); border:1px solid var(--line);
    display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; }

  .dp-card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:12px; }
  .dp-hero { background:linear-gradient(135deg, var(--panel-2), var(--panel)); }
  .dp-cardhead { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
  .dp-cardhead h3 { font-family:var(--font-display); font-size:15px; font-weight:600; margin:0; letter-spacing:-0.01em; }

  .dp-statrow { display:flex; gap:10px; }
  .dp-stat { flex:1; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:11px 12px; }
  .dp-statval { font-family:var(--font-mono); font-size:21px; font-weight:500; letter-spacing:-0.02em; }
  .dp-statval small { font-size:12px; margin-left:2px; color:var(--muted); }
  .dp-accent { color:var(--accent); }
  .dp-statlabel { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.07em; margin-top:4px; }

  .dp-session { display:flex; align-items:center; gap:12px; background:var(--bg); border:1px solid var(--line);
    border-radius:12px; padding:12px; margin-bottom:12px; }
  .dp-day { font-family:var(--font-mono); font-size:12px; color:var(--accent); width:34px; font-weight:600; }
  .dp-sessionbody { flex:1; display:flex; flex-direction:column; gap:3px; }
  .dp-sessionbody strong { font-size:14px; }
  .dp-sessionbody em { font-style:normal; font-size:12.5px; color:var(--muted); }

  .dp-pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
  .dp-pill-accent { color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); border:1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
  .dp-pill-warn { color:var(--amber); background:color-mix(in srgb, var(--amber) 12%, transparent); border:1px solid color-mix(in srgb, var(--amber) 30%, transparent); }
  .dp-pill-hard { color:var(--coral); background:color-mix(in srgb, var(--coral) 12%, transparent); border:1px solid color-mix(in srgb, var(--coral) 30%, transparent); }
  .dp-pillrow { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }

  .dp-btnrow { display:flex; gap:10px; align-items:center; }
  .dp-btn-primary { background:var(--accent); color:var(--on-accent); border:none; border-radius:12px; padding:12px 18px;
    font-family:var(--font-body); font-weight:700; font-size:14px; cursor:pointer; }
  .dp-btn-ghost { background:transparent; border:1px solid var(--line); color:var(--ink); border-radius:10px;
    padding:10px 14px; font-family:var(--font-body); font-size:13px; font-weight:600; cursor:pointer; }

  .dp-mono { font-family:var(--font-mono); font-size:13px; }
  .dp-muted { color:var(--muted); }
  .dp-legend { display:flex; gap:16px; margin-top:8px; font-size:11.5px; color:var(--muted); }
  .dp-legend i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }

  .dp-toast { display:flex; align-items:center; gap:12px; background:var(--panel); border:1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius:12px; padding:11px 14px; font-size:13px; margin-bottom:12px; box-shadow:0 8px 28px rgba(0,0,0,0.25); }
  .dp-toast span { flex:1; }
  .dp-link { background:none; border:none; color:var(--accent); font-family:var(--font-body); font-weight:600; font-size:13px; cursor:pointer; padding:0; }

  .dp-nav { display:flex; background:color-mix(in srgb, var(--panel) 92%, transparent); border:1px solid var(--line);
    border-radius:14px; padding:6px 4px; }
  .dp-navitem { flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:5px 2px 3px;
    color:var(--muted); }
  .dp-navactive { color:var(--accent); }
  .dp-navlabel { font-size:9.5px; font-weight:600; letter-spacing:0.02em; }
  .dp-navdate { font-family:var(--font-mono); font-size:11px; font-weight:600; line-height:1; width:20px; height:20px;
    display:inline-flex; align-items:center; justify-content:center; border:1.5px solid currentColor; border-radius:6px; }

  .dp-extras { font-size:11.5px; color:var(--muted); margin:14px 2px 6px; line-height:1.5; }
  .dp-tokens { margin-top:4px; }
  .dp-tokens summary { font-size:12px; color:var(--muted); cursor:pointer; }
  .dp-tokengrid { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; padding:10px 2px; }
  .dp-token { display:inline-flex; align-items:center; gap:7px; font-size:11px; }
  .dp-token i { width:13px; height:13px; border-radius:4px; border:1px solid var(--line); flex-shrink:0; }
  .dp-token code { font-family:var(--font-mono); font-size:10.5px; }

  @media (max-width:480px){ .dp-statrow { flex-wrap:wrap; } .dp-stat { min-width:90px; } }
`;
