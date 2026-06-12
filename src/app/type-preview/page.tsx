// @ts-nocheck
"use client";

/* ============================================================
   THROWAWAY type-system preview for the Fieldnote theme.
   The palette is settled; this compares four candidate type
   systems (display + body + numerals) plus text-treatment
   notes, on realistic slices from different pages.
   Nothing imports this route; deleted once a system is picked.
   ============================================================ */

import React from "react";
import {
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Newsreader,
  Inter,
  Inter_Tight,
  JetBrains_Mono,
  Spline_Sans_Mono,
  Figtree,
} from "next/font/google";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--tp-plexsans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--tp-plexmono" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--tp-newsreader" });
const inter = Inter({ subsets: ["latin"], variable: "--tp-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--tp-intertight" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--tp-jetbrains" });
const splineMono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--tp-spline" });
const figtree = Figtree({ subsets: ["latin"], variable: "--tp-figtree" });

const SYSTEMS = [
  {
    id: "plex",
    name: "1 · Plex Field",
    blurb:
      "The IBM Plex superfamily — designed as an instrument face. Sans for everything, Plex Mono for numerals: same skeleton, so numbers feel native instead of pasted in. The most literal 'fieldnote' voice.",
    typeNote: "IBM Plex Sans 600/700 display · IBM Plex Sans 400/500 body · IBM Plex Mono 400/500 numerals",
    treatment: "Bigger stat numerals (26px), labels stay uppercase but tracking relaxed, headings sentence-case at 600.",
    display: "var(--tp-plexsans), system-ui, sans-serif",
    body: "var(--tp-plexsans), system-ui, sans-serif",
    mono: "var(--tp-plexmono), ui-monospace, monospace",
    displayWeight: 600,
    tabular: false,
  },
  {
    id: "editorial",
    name: "2 · Morning Edition",
    blurb:
      "Serif display over a quiet grotesque body — the running journal reading. Newsreader only carries headings and the brand; numbers stay in a clean, un-quirky mono (Spline Sans Mono, none of Space Mono's retro curls).",
    typeNote: "Newsreader 600 display · Inter 400/600 body · Spline Sans Mono 400/500 numerals",
    treatment: "Headings larger (18px) with serif warmth, micro-labels lose the uppercase shout (small + muted instead), body line-height up to 1.6.",
    display: "var(--tp-newsreader), Georgia, serif",
    body: "var(--tp-inter), system-ui, sans-serif",
    mono: "var(--tp-spline), ui-monospace, monospace",
    displayWeight: 600,
    tabular: false,
  },
  {
    id: "swiss",
    name: "3 · Quiet Swiss",
    blurb:
      "Type that disappears. Inter Tight headlines, Inter body, JetBrains Mono numerals (the app's original mono — proven on this data). Hierarchy comes from size and weight only; zero personality tax.",
    typeNote: "Inter Tight 700 display (tight tracking) · Inter 400/600 body · JetBrains Mono 400/600 numerals",
    treatment: "Tighter headline tracking (-0.03em), hero numerals up to 28px, everything else slightly smaller and calmer.",
    display: "var(--tp-intertight), system-ui, sans-serif",
    body: "var(--tp-inter), system-ui, sans-serif",
    mono: "var(--tp-jetbrains), ui-monospace, monospace",
    displayWeight: 700,
    tabular: false,
  },
  {
    id: "humanist",
    name: "4 · Plainhand",
    blurb:
      "No mono at all — in case the mono-numeral conceit itself is the problem. Figtree everywhere, with tabular figures (lining, fixed-width) so columns of numbers still align without the typewriter look.",
    typeNote: "Figtree 700 display · Figtree 400/600 body · Figtree + tabular-nums for numerals",
    treatment: "Single family, friendlier curves; numerals use font-variant-numeric: tabular-nums; labels sentence-case.",
    display: "var(--tp-figtree), system-ui, sans-serif",
    body: "var(--tp-figtree), system-ui, sans-serif",
    mono: "var(--tp-figtree), system-ui, sans-serif",
    displayWeight: 700,
    tabular: true,
  },
];

const SPLITS = [
  ["1", "4:52", "148", "12m"],
  ["2", "4:47", "153", "8m"],
  ["3", "4:39", "159", "-4m"],
];

function Specimen({ s }) {
  return (
    <section
      className="tp-card"
      style={{
        "--font-display": s.display,
        "--font-body": s.body,
        "--font-mono": s.mono,
        "--dw": s.displayWeight,
        "--tnum": s.tabular ? "tabular-nums" : "normal",
      }}
    >
      <div className="tp-meta">
        <h2>{s.name}</h2>
        <p>{s.blurb}</p>
        <p className="tp-note">{s.typeNote}</p>
        <p className="tp-note">Treatment: {s.treatment}</p>
      </div>

      {/* brand + greeting (topbar voice) */}
      <div className="tp-row tp-brandrow">
        <span className="tp-brand">STRIDE<span className="tp-dot">.</span></span>
        <span className="tp-muted">Hi, Chris</span>
      </div>

      {/* Today: hero stats */}
      <div className="tp-panel">
        <h3 className="tp-h3">This week</h3>
        <div className="tp-stats">
          <div><span className="tp-num">24.5</span><label>Volume · km</label></div>
          <div><span className="tp-num">4:52</span><label>Avg pace</label></div>
          <div><span className="tp-num">3/4</span><label>Sessions</label></div>
        </div>
      </div>

      {/* Plan: session description (body text voice) */}
      <div className="tp-panel">
        <h3 className="tp-h3">Tempo / Threshold</h3>
        <p className="tp-body">
          Comfortably hard — about your one-hour race effort. 2km easy, then
          4 × 1.5km at <span className="tp-innum">4:35–4:42/km</span> with 90s float,
          2km easy home. Builds your lactate ceiling.
        </p>
        <p className="tp-mutedsmall">Conversational pace. Talk in full sentences. This is most of your running.</p>
      </div>

      {/* Activities: splits table (numeral alignment voice) */}
      <div className="tp-panel">
        <h3 className="tp-h3">Splits</h3>
        <div className="tp-table">
          <div className="tp-tr tp-thead"><span>km</span><span>pace</span><span>hr</span><span>elev</span></div>
          {SPLITS.map((r) => (
            <div className="tp-tr" key={r[0]}>{r.map((c, i) => <span key={i} className={i ? "tp-innum" : "tp-innum tp-mutedc"}>{c}</span>)}</div>
          ))}
        </div>
      </div>

      {/* buttons + pills */}
      <div className="tp-row">
        <button className="tp-btn">＋ Log a run</button>
        <span className="tp-pill">Good run · 8/10</span>
        <span className="tp-pill tp-pill-bad">Pain flag · knee</span>
      </div>
    </section>
  );
}

export default function TypePreview() {
  return (
    <main className={`tp-page ${plexSans.variable} ${plexMono.variable} ${newsreader.variable} ${inter.variable} ${interTight.variable} ${jetbrains.variable} ${splineMono.variable} ${figtree.variable}`}>
      <style>{CSS}</style>
      <header className="tp-head">
        <h1>Fieldnote — type systems</h1>
        <p>Same palette, four type voices. Each shows the topbar, a hero stat, plan prose, a splits table, and controls.</p>
      </header>
      {SYSTEMS.map((s) => <Specimen key={s.id} s={s} />)}
    </main>
  );
}

const CSS = `
  .tp-page { --bg:#e9e7e1; --panel:#f5f4ef; --panel-2:#dfdcd3; --line:#c8c4b8; --ink:#21201c;
    --muted:#66635a; --accent:#21201c; --coral:#b3402e; --on-accent:#f5f4ef;
    background:var(--bg); min-height:100vh; margin:0 auto; padding:26px 0 80px; color:var(--ink); }
  .tp-head { max-width:560px; margin:0 auto 24px; padding:0 22px; font-family:system-ui, sans-serif; }
  .tp-head h1 { font-size:20px; margin:0 0 6px; }
  .tp-head p { font-size:13px; color:var(--muted); margin:0; line-height:1.5; }

  .tp-card { max-width:560px; margin:0 auto 30px; padding:20px 22px 24px; background:var(--panel);
    border:1px solid var(--line); border-radius:20px; font-family:var(--font-body); }
  .tp-meta h2 { font-family:var(--font-display); font-weight:var(--dw); font-size:21px; margin:0 0 6px; }
  .tp-meta p { font-size:13px; color:var(--muted); line-height:1.55; margin:0 0 5px; }
  .tp-note { font-size:11.5px; }

  .tp-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:14px; }
  .tp-brandrow { justify-content:space-between; margin-top:18px; }
  .tp-brand { font-family:var(--font-display); font-weight:800; font-size:24px; letter-spacing:-0.03em; }
  .tp-dot { color:var(--coral); }
  .tp-muted { color:var(--muted); font-size:14px; }

  .tp-panel { background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin-top:14px; }
  .tp-h3 { font-family:var(--font-display); font-weight:var(--dw); font-size:16px; margin:0 0 10px; letter-spacing:-0.01em; }
  .tp-stats { display:flex; gap:18px; }
  .tp-stats > div { display:flex; flex-direction:column; gap:3px; }
  .tp-num { font-family:var(--font-mono); font-variant-numeric:var(--tnum); font-size:25px; font-weight:500; letter-spacing:-0.02em; }
  .tp-stats label { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; }
  .tp-body { font-size:14px; line-height:1.6; margin:0 0 8px; }
  .tp-innum { font-family:var(--font-mono); font-variant-numeric:var(--tnum); font-size:0.95em; font-weight:500; }
  .tp-mutedsmall { font-size:12.5px; color:var(--muted); line-height:1.5; margin:0; }
  .tp-mutedc { color:var(--muted); }

  .tp-table { display:flex; flex-direction:column; }
  .tp-tr { display:grid; grid-template-columns:44px 1fr 1fr 1fr; gap:8px; padding:7px 0; border-top:1px solid var(--line); font-size:13.5px; }
  .tp-tr:first-of-type { border-top:none; }
  .tp-thead span { font-family:var(--font-body); font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }

  .tp-btn { background:var(--accent); color:var(--on-accent); border:none; border-radius:12px; padding:12px 18px;
    font-family:var(--font-body); font-weight:700; font-size:14px; cursor:pointer; }
  .tp-pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px;
    color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, transparent); border:1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
  .tp-pill-bad { color:var(--coral); background:color-mix(in srgb, var(--coral) 12%, transparent); border-color:color-mix(in srgb, var(--coral) 30%, transparent); }
`;
