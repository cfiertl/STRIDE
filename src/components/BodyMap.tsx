// @ts-nocheck
"use client";

import { useState, useRef } from "react";

/**
 * BodyMap — clickable front + back figure for pain logging.
 *
 * collapsible: render a tappable "Any pain?" disclosure row that expands the
 *   figure. Starts open if pain is already logged. When collapsed with areas
 *   selected, the chips stay visible as a removable summary.
 * note: optional muted line shown under the header when expanded.
 *
 * Left/right are now independent: each side emits its own string
 * ("Left knee (front)" / "Right knee (front)"). Central regions
 * (Lower back) stay unqualified. Still a plain string[] — no schema change.
 *
 * Side is ANATOMICAL (the runner's own L/R). On a front view that means the
 * leg on screen-left is the Right leg — the L/R letters on each figure make
 * this unambiguous when tapping.
 *
 * Tooltip: mouse hovers show the region name; touch/pen flashes it for ~1.3s.
 *
 * Usage (ScoreCard / LogRun):
 *   <BodyMap selected={pain} onToggle={(a) => toggle(pain, setPain, a)} />
 */

const SIL_PATH =
  "M120,80 C128,80 131,82 134,86 C140,94 146,101 160,108 C171,112 178,118 181,128 " +
  "C184,150 181,210 176,262 C175,278 174,294 172,306 C171,316 169,324 165,326 " +
  "C161,328 158,324 157,316 C155,300 156,272 157,244 C158,216 157,184 154,160 " +
  "C153,156 152,154 150,156 C150,150 149,148 147,148 C144,150 142,158 141,170 " +
  "C140,186 139,200 140,214 C141,228 145,240 150,250 C154,258 156,266 156,276 " +
  "C156,300 152,330 150,356 C149,368 148,376 147,386 C146,400 145,418 143,436 " +
  "C142,448 139,458 134,466 C132,470 131,474 132,478 C133,484 140,488 148,489 " +
  "C150,489 151,490 150,492 L122,492 C120,492 120,488 120,484 C120,478 121,470 122,460 " +
  "C124,440 125,420 125,400 C125,384 124,366 123,348 C122,326 121,304 120,288 Z";

const SIL = "var(--line)";
const VB_W = 430;

type Side = "L" | "R";
type Ellipse = { cx: number; cy: number; rx: number; ry: number; side?: Side };
type Region = { area: string; shapes: Ellipse[] };
type Offset = { x: number; y: number };

const sideWord = (s?: Side) => (s === "L" ? "Left" : s === "R" ? "Right" : "");
const labelFor = (area: string, side?: Side) => (side ? `${sideWord(side)} ${area}` : area);

// FRONT view: screen-left (cx < 120) is the runner's RIGHT side.
const FRONT_REGIONS: Region[] = [
  { area: "Hip / glute", shapes: [{ cx: 107, cy: 250, rx: 13, ry: 15, side: "R" }, { cx: 133, cy: 250, rx: 13, ry: 15, side: "L" }] },
  { area: "Quadriceps", shapes: [{ cx: 104, cy: 298, rx: 12, ry: 22, side: "R" }, { cx: 136, cy: 298, rx: 12, ry: 22, side: "L" }] },
  { area: "Knee (outside / ITB)", shapes: [{ cx: 95, cy: 346, rx: 9, ry: 24, side: "R" }, { cx: 145, cy: 346, rx: 9, ry: 24, side: "L" }] },
  { area: "Knee (front)", shapes: [{ cx: 108, cy: 374, rx: 11, ry: 11, side: "R" }, { cx: 132, cy: 374, rx: 11, ry: 11, side: "L" }] },
  { area: "Shin", shapes: [{ cx: 110, cy: 418, rx: 8, ry: 24, side: "R" }, { cx: 130, cy: 418, rx: 8, ry: 24, side: "L" }] },
  { area: "Ankle", shapes: [{ cx: 112, cy: 460, rx: 8, ry: 8, side: "R" }, { cx: 128, cy: 460, rx: 8, ry: 8, side: "L" }] },
  { area: "Foot / arch", shapes: [{ cx: 112, cy: 481, rx: 13, ry: 8, side: "R" }, { cx: 128, cy: 481, rx: 13, ry: 8, side: "L" }] },
];

// BACK view: screen-left (cx < 120) is the runner's LEFT side.
const BACK_REGIONS: Region[] = [
  { area: "Lower back", shapes: [{ cx: 120, cy: 232, rx: 21, ry: 17 }] },
  { area: "Hip / glute", shapes: [{ cx: 107, cy: 262, rx: 13, ry: 14, side: "L" }, { cx: 133, cy: 262, rx: 13, ry: 14, side: "R" }] },
  { area: "Hamstring", shapes: [{ cx: 108, cy: 330, rx: 11, ry: 26, side: "L" }, { cx: 132, cy: 330, rx: 11, ry: 26, side: "R" }] },
  { area: "Calf", shapes: [{ cx: 110, cy: 414, rx: 9, ry: 24, side: "L" }, { cx: 130, cy: 414, rx: 9, ry: 24, side: "R" }] },
  { area: "Achilles", shapes: [{ cx: 112, cy: 456, rx: 6, ry: 13, side: "L" }, { cx: 128, cy: 456, rx: 6, ry: 13, side: "R" }] },
];

function Figure({
  regions,
  offset,
  leftMark,
  rightMark,
  selected,
  onEnter,
  onLeave,
  onDown,
  onActivate,
}: {
  regions: Region[];
  offset: Offset;
  leftMark: string;
  rightMark: string;
  selected: string[];
  onEnter: (e: any, label: string, gx: number, gy: number) => void;
  onLeave: (e: any) => void;
  onDown: (e: any) => void;
  onActivate: (label: string, gx: number, gy: number) => void;
}) {
  return (
    <g transform={`translate(${offset.x},${offset.y})`}>
      <ellipse cx={120} cy={46} rx={23} ry={31} fill={SIL} />
      <path fill={SIL} d={SIL_PATH} />
      <path fill={SIL} transform="translate(240,0) scale(-1,1)" d={SIL_PATH} />
      <text className="bm-mark" x={66} y={100}>{leftMark}</text>
      <text className="bm-mark" x={174} y={100}>{rightMark}</text>
      {regions.map((r) =>
        r.shapes.map((s, i) => {
          const label = labelFor(r.area, s.side);
          const gx = s.cx + offset.x;
          const gy = s.cy - s.ry + offset.y;
          const on = selected.includes(label);
          return (
            <ellipse
              key={label + i}
              className={"bm-e" + (on ? " on" : "")}
              cx={s.cx}
              cy={s.cy}
              rx={s.rx}
              ry={s.ry}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={on}
              onPointerEnter={(e) => onEnter(e, label, gx, gy)}
              onPointerLeave={onLeave}
              onPointerDown={onDown}
              onClick={() => onActivate(label, gx, gy)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(label, gx, gy);
                }
              }}
            />
          );
        })
      )}
    </g>
  );
}

export default function BodyMap({
  selected,
  onToggle,
  collapsible = false,
  label = "Any pain?",
  note,
}: {
  selected: string[];
  onToggle: (area: string) => void;
  collapsible?: boolean;
  label?: string;
  note?: string;
}) {
  const [open, setOpen] = useState<boolean>(!collapsible || selected.length > 0);
  const [active, setActive] = useState<{ label: string; x: number; y: number } | null>(null);
  const lastType = useRef<string>("mouse");
  const flashTimer = useRef<any>(null);

  const onEnter = (e: any, label: string, gx: number, gy: number) => {
    if (e.pointerType === "mouse") setActive({ label, x: gx, y: gy });
  };
  const onLeave = (e: any) => {
    if (e.pointerType === "mouse") setActive(null);
  };
  const onDown = (e: any) => {
    lastType.current = e.pointerType;
  };
  const onActivate = (label: string, gx: number, gy: number) => {
    onToggle(label);
    if (lastType.current !== "mouse") {
      setActive({ label, x: gx, y: gy });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setActive(null), 1300);
    }
  };

  const tip = (() => {
    if (!active) return null;
    const w = Math.round(active.label.length * 7) + 18;
    const cx = Math.max(w / 2 + 2, Math.min(VB_W - w / 2 - 2, active.x));
    const top = active.y - 30;
    return (
      <g pointerEvents="none">
        <rect x={cx - w / 2} y={top} width={w} height={22} rx={6} fill="var(--ink)" style={{ stroke: "var(--accent)" }} strokeOpacity={0.6} />
        <text x={cx} y={top + 15} fill="var(--bg)" fontSize={13} textAnchor="middle">{active.label}</text>
      </g>
    );
  })();

  const styleTag = (
    <style>{`
        .bm-e { fill: transparent; stroke: var(--muted); stroke-opacity: .35; stroke-width: 1.2; cursor: pointer; transition: fill .12s, stroke .12s; outline: none; }
        .bm-e:focus-visible { stroke: var(--accent); stroke-opacity: .9; }
        @media (hover: hover) {
          .bm-e:hover { stroke: var(--accent); stroke-opacity: .85; fill: var(--accent); fill-opacity: .10; }
        }
        .bm-e.on { fill: var(--coral); fill-opacity: .55; stroke: var(--coral); stroke-opacity: .95; }
        .bm-mark { fill: var(--muted); opacity: .6; font-size: 13px; font-weight: 500; text-anchor: middle; pointer-events: none; }
        .bm-head:hover { opacity: .85; }
      `}</style>
  );

  const svgEl = (
    <svg viewBox={`0 0 ${VB_W} 520`} xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "auto", display: "block", maxWidth: VB_W }}>
      <Figure regions={FRONT_REGIONS} offset={{ x: 8, y: 6 }} leftMark="R" rightMark="L" selected={selected} onEnter={onEnter} onLeave={onLeave} onDown={onDown} onActivate={onActivate} />
      <Figure regions={BACK_REGIONS} offset={{ x: 210, y: 6 }} leftMark="L" rightMark="R" selected={selected} onEnter={onEnter} onLeave={onLeave} onDown={onDown} onActivate={onActivate} />
      <text x={128} y={514} fill="var(--muted)" fontSize={13} textAnchor="middle">front</text>
      <text x={338} y={514} fill="var(--muted)" fontSize={13} textAnchor="middle">back</text>
      {tip}
    </svg>
  );

  const chipsEl = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, minHeight: 30 }}>
      {selected.length === 0 ? (
        <span style={{ color: "var(--muted)", fontSize: 13 }}>No areas selected</span>
      ) : (
        selected.map((a) => (
          <span
            key={a}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "color-mix(in srgb, var(--coral) 12%, transparent)", color: "var(--coral)", border: "1px solid color-mix(in srgb, var(--coral) 50%, transparent)", borderRadius: 999, padding: "5px 6px 5px 12px", fontSize: 13 }}
          >
            {a}
            <button
              type="button"
              aria-label={"Remove " + a}
              onClick={() => onToggle(a)}
              style={{ all: "unset", cursor: "pointer", display: "inline-flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: "50%", color: "var(--coral)", fontSize: 14, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))
      )}
    </div>
  );

  if (collapsible) {
    return (
      <div>
        {styleTag}
        <button
          type="button"
          className="bm-head"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", padding: "4px 0", cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}
        >
          <span style={{ fontSize: 15, fontWeight: 500 }}>{label}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
            {!open && selected.length > 0 && (
              <span>{selected.length} area{selected.length > 1 ? "s" : ""}</span>
            )}
            <span style={{ display: "inline-block", fontSize: 16, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
          </span>
        </button>
        {open && note && <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>{note}</p>}
        {open && svgEl}
        {(open || selected.length > 0) && chipsEl}
      </div>
    );
  }

  return (
    <div>
      {styleTag}
      {svgEl}
      {chipsEl}
    </div>
  );
}