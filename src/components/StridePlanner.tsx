// @ts-nocheck
"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/utils/supabase/client";
import { ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import dynamic from "next/dynamic";
import BodyMap from "@/components/BodyMap";
import PushToggle from "@/components/PushToggle";
import SignOutButton from "@/components/SignOutButton";
const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false, loading: () => <div className="card muted small">Loading map…</div> });

/* ============================================================
   STRIDE — a running planner
   Single-file React app. Persists to Supabase (Postgres) via per-domain functions.
   ============================================================ */

/* ---------- time + math helpers ---------- */

// parse "mm:ss" or "h:mm:ss" -> seconds
function parseTime(str) {
  if (!str) return 0;
  const parts = String(str).trim().split(":").map((p) => parseFloat(p));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60; // bare minutes
  return 0;
}

// seconds -> "h:mm:ss" or "mm:ss"
function fmtTime(sec) {
  if (!sec || sec <= 0) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// pace seconds-per-km -> "m:ss/km"
function fmtPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0 || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

// pace without the "/km" suffix — for tight stat boxes where a label already says PACE
function fmtPaceBare(secPerKm) {
  const p = fmtPace(secPerKm);
  return p === "—" ? p : p.replace("/km", "");
}

// a pace difference (seconds) as "M:SS" or "Ns" — for "X/km quicker than…" copy
function fmtPaceDelta(sec) {
  const s = Math.round(Math.abs(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

// Riegel race-time prediction: t2 = t1 * (d2/d1)^1.06
function riegel(t1, d1, d2) {
  return t1 * Math.pow(d2 / d1, 1.06);
}

// Threshold pace ~= pace sustainable for a 60-min effort, derived from a benchmark.
function thresholdPace(benchDistKm, benchTimeSec) {
  if (!benchDistKm || !benchTimeSec) return 0;
  // distance achievable in 3600s at current fitness (invert Riegel)
  const dThr = benchDistKm * Math.pow(3600 / benchTimeSec, 1 / 1.06);
  return 3600 / dThr; // sec per km
}

// training zones as ranges off threshold pace (sec/km). Returns [slow, fast].
function zonesFromThreshold(thr) {
  if (!thr) return null;
  return {
    easy: [thr * 1.30, thr * 1.22],
    long: [thr * 1.28, thr * 1.20],
    marathon: [thr * 1.13, thr * 1.08],
    tempo: [thr * 1.02, thr * 0.99],
    interval: [thr * 0.94, thr * 0.90],
    reps: [thr * 0.90, thr * 0.86],
  };
}

// Build zones for a profile. If the runner has told us their real easy/conversational
// pace, anchor easy + long to THAT rather than deriving it (fixes the "Runna told me to
// run my easy days too fast" problem). The fast end still comes from the benchmark.
function computeZones(profile) {
  if (!profile) return null;
  const hasBench = profile.benchDistKm && profile.benchTimeSec;
  let z = hasBench ? zonesFromThreshold(thresholdPace(profile.benchDistKm, profile.benchTimeSec)) : null;
  if (profile.easyPaceSec) {
    const e = profile.easyPaceSec;
    if (!z) z = { easy: null, long: null, marathon: null, tempo: null, interval: null, reps: null };
    z.easy = [e * 1.04, e * 0.97];
    z.long = [e * 1.03, e * 0.95];
  }
  return z;
}

// `effort` is the feel-based anchor for the zone. GPS pace is too noisy to chase
// inside a short rep — it needs ~15–20s to settle after a change — so the effort
// cue is what you actually run to, with the pace band as the guardrail.
const ZONE_META = {
  easy: { name: "Easy / Zone 2", effort: "conversational", note: "Conversational. Talk in full sentences. This is most of your running." },
  long: { name: "Long run", effort: "conversational", note: "Easy effort, sustained. Build endurance and fatigue resistance." },
  marathon: { name: "Marathon pace", effort: "steady, controlled", note: "Steady, controlled, 'comfortably hard'." },
  tempo: { name: "Tempo / Threshold", effort: "~1hr race effort", note: "Comfortably hard. ~1hr race effort. Builds your lactate ceiling." },
  interval: { name: "Interval / VO2", effort: "3k–5k effort", note: "Hard. 3–5min reps. Lifts top-end aerobic power." },
  reps: { name: "Reps / Strides", effort: "fast & relaxed", note: "Fast & short. Form, economy, leg speed. Stay relaxed." },
};

/* ---------- plan generation ---------- */

function weeksBetween(fromISO, toISO) {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  const ms = b - a;
  return Math.max(0, Math.round(ms / (7 * 24 * 3600 * 1000)));
}

/* ---------- calendar helpers (start-date-anchored plans) ---------- */

const DAY_MS = 24 * 3600 * 1000;
// DOW (Sun..Sat) is declared lower in the file; these helpers only run at
// render time, by which point the const is initialised.

// local YYYY-MM-DD for a Date (or now). Avoids UTC drift from toISOString().
function isoDate(d) {
  const x = d ? new Date(d) : new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function todayISO() { return isoDate(); }

// add n whole days to a YYYY-MM-DD and return YYYY-MM-DD (parsed as local noon
// so DST never nudges the calendar day).
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function dowName(iso) { return DOW[new Date(`${iso}T12:00:00`).getDay()]; }

// The Monday on or before `iso`. Plan weeks are Monday→Sunday calendar weeks,
// so the first week can be partial (only the run days from the start date on).
function mondayOf(iso) {
  const dow = new Date(`${iso}T12:00:00`).getDay(); // Sun=0..Sat=6
  return addDays(iso, -((dow + 6) % 7));
}

// Given a 7-day block starting at weekStartISO, the date of weekday `day`
// (e.g. "Tue") that falls inside [weekStart, weekStart+6].
function dateForDayInWeek(weekStartISO, day) {
  const startDow = new Date(`${weekStartISO}T12:00:00`).getDay();
  const targetDow = DOW.indexOf(day);
  if (targetDow < 0) return weekStartISO;
  return addDays(weekStartISO, (targetDow - startDow + 7) % 7);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Tue 17 Jun"
function fmtDayDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
// "17 Jun" (no weekday) — for week ranges
function fmtShortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function generatePlan(profile) {
  const { goalDistanceKm, goalDate, currentWeeklyKm, daysPerWeek } = profile;
  if (!goalDistanceKm || !goalDate || !currentWeeklyKm) return [];
  const start = profile.planStartDate || todayISO();
  // Plan weeks are Monday→Sunday calendar weeks. Week 1 begins on the start
  // date but only spans to that week's Sunday, so it can be partial.
  const firstMonday = mondayOf(start);
  const spanDays = Math.round((new Date(`${goalDate}T12:00:00`) - new Date(`${firstMonday}T12:00:00`)) / DAY_MS);
  const totalWeeks = Math.min(24, Math.max(4, Math.ceil(spanDays / 7)));
  const days = Math.min(6, Math.max(2, daysPerWeek || 4));

  // which weekdays the runner uses + which is the long run
  const sched = resolveSchedule(profile, days);
  const overrides = profile.scheduleOverrides || {};

  // taper length scales with goal distance
  const taper = profile.goalMode === "fitness" ? 0 : (goalDistanceKm >= 30 ? 3 : goalDistanceKm >= 15 ? 2 : 1);
  const buildWeeks = Math.max(2, totalWeeks - taper);

  // peak weekly volume: progress ~ from current, 10%/wk, cutback every 4th
  const weeks = [];
  let vol = currentWeeklyKm;
  for (let w = 0; w < totalWeeks; w++) {
    const isTaper = w >= buildWeeks;
    const cutback = !isTaper && w > 0 && (w + 1) % 4 === 0;
    if (isTaper) {
      const t = w - buildWeeks; // 0..taper-1
      vol = currentWeeklyKm + (peakVol(currentWeeklyKm, buildWeeks) - currentWeeklyKm) * (1 - (t + 1) / (taper + 1));
    } else if (cutback) {
      vol = vol * 0.75;
    } else if (w > 0) {
      vol = vol * 1.10;
    }
    const weekVol = Math.round(vol);
    const weekStart = addDays(firstMonday, w * 7);
    weeks.push(buildWeek(w, totalWeeks, weekVol, goalDistanceKm, days, isTaper, cutback, sched, weekStart, overrides, start));
  }
  return weeks;
}

// Decide which weekdays carry the long run / quality / easy sessions. Uses the
// runner's chosen preferred days + long day; falls back to the historical
// hardcoded pattern when those aren't set (legacy profiles, pre-resave).
function resolveSchedule(profile, days) {
  let pref = Array.isArray(profile.preferredDays) ? profile.preferredDays.filter((d) => DOW.includes(d)) : [];
  let longDay = profile.longDay && pref.includes(profile.longDay) ? profile.longDay : null;
  if (pref.length !== days || !longDay) {
    const legacyOrder = ["Sun", "Tue", "Thu", "Mon", "Wed", "Fri", "Sat"];
    pref = legacyOrder.slice(0, days);
    longDay = pref.includes("Sun") ? "Sun" : pref[0];
  }
  // non-long days, ordered by circular weekday separation from the long run
  // (descending) so quality lands furthest from the long run.
  const li = DOW.indexOf(longDay);
  const sep = (d) => { const k = Math.abs(DOW.indexOf(d) - li); return Math.min(k, 7 - k); };
  const rest = pref.filter((d) => d !== longDay).sort((a, b) => sep(b) - sep(a));
  return { longDay, rest };
}

function peakVol(start, buildWeeks) {
  // approximate peak after compounding ~10%/wk with periodic cutbacks
  let v = start;
  for (let i = 1; i < buildWeeks; i++) {
    if ((i + 1) % 4 === 0) v *= 0.75;
    else v *= 1.1;
  }
  return v;
}

function buildWeek(idx, total, weekVol, goalKm, days, isTaper, cutback, sched, weekStart, overrides, start) {
  // long run grows toward ~ goalKm (capped for safety) but eased in taper
  const longCap = goalKm <= 10 ? goalKm * 1.0 : goalKm <= 21.1 ? goalKm * 0.95 : goalKm * 0.80;
  const progress = Math.min(1, (idx + 1) / Math.max(1, total - 2));
  let longKm = Math.round(Math.min(longCap, Math.max(goalKm * 0.35, longCap * progress)));
  if (isTaper) longKm = Math.round(longKm * 0.7);

  const slots = [];
  // 1 long, on the chosen long day
  slots.push({ day: sched.longDay, type: "long", km: longKm });
  // quality sessions: alternate tempo / interval. fewer during taper/cutback
  const qualityCount = isTaper || cutback ? 1 : days >= 5 ? 2 : 1;
  const qualityDays = sched.rest.slice(0, qualityCount);
  qualityDays.forEach((day, i) => {
    slots.push({ day, type: (idx + i) % 2 === 0 ? "tempo" : "interval", quality: true });
  });

  // fill remaining preferred days with easy/zone2 runs to hit volume
  const easyD = sched.rest.slice(qualityCount);
  const remaining = Math.max(0, weekVol - longKm - qualityCount * 6); // assume ~6km per quality incl w/u
  const perEasy = easyD.length > 0 ? Math.max(4, Math.round(remaining / easyD.length)) : 0;
  easyD.forEach((day) => slots.push({ day, type: "easy", km: perEasy }));

  // resolve each slot onto a real date in this week's 7-day block, applying any
  // user override (a moved date, or "skipped"). origDay is the generated day —
  // the stable key overrides are stored against.
  const week = idx + 1;
  let sessions = slots.map((s) => {
    const origDay = s.day;
    const ov = overrides[`${week}:${origDay}`];
    let date = dateForDayInWeek(weekStart, origDay);
    let skipped = false;
    if (ov === "skipped") skipped = true;
    else if (typeof ov === "string" && ov) date = ov;
    return { ...s, origDay, day: dowName(date), date, skipped };
  });

  // Drop run days that can't actually be run: anything before the plan's start
  // date. A plan generated on Saturday starts that Saturday, so week 1's Mon–Fri
  // fall away here and the week's volume target scales to what's left.
  //
  // Deliberately NOT filtered against today: the plan is derived fresh on every
  // render, so a "hide days already past this week" rule would keep firing as the
  // week wore on and silently delete a session the moment its day passed. A
  // prescribed day stands once set — a run that wasn't done shows up as overdue
  // (see overdueSessions) and it's the runner's call to move or skip it.
  let volume = weekVol;
  const full = sessions.length;
  sessions = sessions.filter((s) => s.date >= start);
  if (full > 0 && sessions.length < full) volume = Math.round(weekVol * sessions.length / full);
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    week,
    weekStart,
    volume,
    label: isTaper ? "Taper" : cutback ? "Recovery week" : idx === 0 ? "Base" : "Build",
    sessions,
  };
}

// A session's shape as executable steps rather than a sentence. This is the one
// source of truth: the prose description, the duration estimate and the on-screen
// breakdown all derive from it, so a change to a session's prescription happens
// here and shows up everywhere. Steps are one of:
//   { kind:"steady",  label, km, zone }                     distance-led
//   { kind:"warmup"|"work"|"cooldown", label, sec, secRange?, zone }
//   { kind:"reps", reps, work:{label,sec,zone}, rest:{label,sec,zone} }
// `zone` names a band in computeZones(), so paces stay tied to current fitness.
function sessionSteps(s) {
  if (s.type === "tempo") {
    return [
      { kind: "warmup", label: "Easy warm-up", sec: 15 * 60, zone: "easy" },
      { kind: "work", label: "Threshold", sec: 22 * 60 + 30, secRange: [20 * 60, 25 * 60], zone: "tempo" },
      { kind: "cooldown", label: "Easy cool-down", sec: 10 * 60, zone: "easy" },
    ];
  }
  if (s.type === "interval") {
    return [
      { kind: "warmup", label: "Easy warm-up with strides", sec: 15 * 60, zone: "easy" },
      {
        kind: "reps",
        reps: 5,
        work: { label: "Hard", sec: 3 * 60, zone: "interval" },
        rest: { label: "Jog", sec: 90, zone: "easy" },
      },
      { kind: "cooldown", label: "Easy cool-down", sec: 10 * 60, zone: "easy" },
    ];
  }
  return [{ kind: "steady", label: s.type === "long" ? "Long run" : "Easy", km: s.km, zone: s.type }];
}

// Seconds a step occupies. Reps carry recoveries *between* efforts only — the
// last one runs straight into the cool-down. `end` picks the slow/fast end of a
// step that's prescribed as a range (the tempo block).
// Does this session have a real prescription, or is it one steady block? Decides
// whether a step breakdown is worth rendering at all.
function hasSteps(s) {
  const steps = sessionSteps(s);
  return !(steps.length === 1 && steps[0].kind === "steady");
}

function stepSeconds(step, end = "mid") {
  if (step.kind === "reps") {
    return step.reps * step.work.sec + (step.reps - 1) * step.rest.sec;
  }
  if (step.secRange) return end === "min" ? step.secRange[0] : end === "max" ? step.secRange[1] : step.sec;
  return step.sec || 0;
}

// Estimated duration band (seconds). Distance-led sessions come from km × the
// pace band; structured sessions are summed from their steps.
// Zone bands run [slower, faster], so the slower end gives the LONGER time —
// this used to return the pair the other way round and printed "~65–61 min".
function sessionDurationRange(s, zones) {
  const steps = sessionSteps(s);
  const steady = steps.length === 1 && steps[0].kind === "steady" ? steps[0] : null;
  if (steady) {
    if (!(steady.km > 0)) return null;
    const pz = zones && zones[steady.zone];
    if (!pz) return null;
    return [Math.round(steady.km * pz[1]), Math.round(steady.km * pz[0])]; // faster first
  }
  const lo = steps.reduce((a, st) => a + stepSeconds(st, "min"), 0);
  const hi = steps.reduce((a, st) => a + stepSeconds(st, "max"), 0);
  return [lo, hi];
}

function fmtMins(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function fmtDurRange(range) {
  if (!range) return "";
  const [a, b] = range;
  const ma = Math.round(a / 60), mb = Math.round(b / 60);
  if (ma === mb) return `~${fmtMins(a)}`;
  if (ma < 60 && mb < 60) return `~${ma}–${mb} min`;
  return `~${fmtMins(a)}–${fmtMins(b)}`;
}

// Pace prescription for a step. Bands run [slower, faster] and every zone quotes
// the whole band, fast end first.
//
// Intervals used to quote the fast edge alone, which read as a precise target the
// zone model never actually prescribed — and no GPS watch can resolve a single
// pace inside a 3-minute rep anyway. The band is both the honest number and the
// usable one; stepEffort() carries the feel cue that goes with it.
function stepPace(step, zones, fallback) {
  const band = zones && step.zone && zones[step.zone];
  if (!band) return fallback;
  const fast = fmtPace(band[1]);
  const slow = fmtPace(band[0]);
  // "4:03–4:14/km", not "4:03/km–4:14/km"
  return fast === slow ? fast : `${fast.replace("/km", "")}–${slow}`;
}

// Feel-based anchor for a step, e.g. "3k–5k effort". Empty when the zone has none.
function stepEffort(step) {
  const meta = step.zone && ZONE_META[step.zone];
  return (meta && meta.effort) || "";
}

function sessionDescription(s, zones) {
  const dur = sessionDurationRange(s, zones);
  const durStr = dur ? `${fmtDurRange(dur)} · ` : "";
  const fuelStr = dur && dur[1] >= 90 * 60
    ? " Long enough to fuel — aim ~30–60g carbs/hour (a gel every ~30–40 min)."
    : "";
  // Structured sessions don't spell the prescription out in prose any more —
  // <SessionSteps/> renders it as a proper breakdown. The row keeps the headline:
  // how long it takes, and what the hard part of it is.
  if (s.type === "tempo" || s.type === "interval") {
    const core = sessionSteps(s).find((st) => st.kind === "reps" || st.kind === "work");
    let headline = "";
    if (core && core.kind === "reps") {
      headline = `${core.reps} × ${fmtTime(core.work.sec)} @ ${stepPace(core.work, zones, "hard")}`;
    } else if (core) {
      const range = core.secRange
        ? `${Math.round(core.secRange[0] / 60)}–${Math.round(core.secRange[1] / 60)} min`
        : fmtMins(core.sec);
      headline = `${range} @ ${stepPace(core, zones, "comfortably hard")}`;
    }
    return {
      title: s.type === "tempo" ? "Tempo / Threshold" : "Intervals (VO2)",
      detail: [dur ? fmtDurRange(dur) : "", headline].filter(Boolean).join(" · "),
      dur,
    };
  }
  // Easy + long are always conversational, so the pace prescription is noise —
  // just state the distance and the effort. (Pace adherence is surfaced after
  // the run, as a drift flag on the activity. See PaceInsights.)
  if (s.type === "long") {
    return { title: `Long run · ${s.km}km`, detail: `${durStr}conversational, easy by feel.${fuelStr}`, dur };
  }
  return { title: `Easy / Zone 2 · ${s.km}km`, detail: `${durStr}conversational, easy by feel.`, dur };
}

// Planned distance for a session. Distance runs (easy/long) carry it directly;
// structured quality sessions don't, so we use the ~6km the weekly-volume math
// budgets for them (warm-up + work + cool-down). Used for the week's km target.
function plannedKm(s) {
  return s.km != null ? s.km : 6;
}

// Sessions in `week` whose planned day has been and gone with no run linked to
// them. buildWeek leaves them in place rather than hiding them, so this is what
// surfaces them: the Plan marks them "overdue" and Today prompts to move, skip
// or link a run. Once the week rolls over they read as missed (✕) instead.
// doneSet holds `${week}:${day}` keys from session_completions.
function overdueSessions(week, doneSet, today = todayISO()) {
  if (!week) return [];
  return week.sessions.filter(
    (s) => !s.skipped && s.date < today && !doneSet.has(`${week.week}:${s.day}`)
  );
}

// Runs inside `week`'s 7-day block that aren't linked to any planned session.
// These are the candidates for "you ran on Tuesday — count it toward Wednesday's
// tempo?", so a casual run can be reconciled instead of leaving a hole.
function unlinkedRunsInWeek(week, runs, completions) {
  if (!week) return [];
  const linked = new Set(completions.map((c) => c.activity_id));
  const end = addDays(week.weekStart, 7);
  return runs
    .filter((r) => {
      const d = isoDate(r.date);
      return d >= week.weekStart && d < end && !linked.has(r.id);
    })
    .sort((a, b) => (isoDate(a.date) < isoDate(b.date) ? -1 : 1));
}

/* ---------- adaptive fitness ---------- */

// Scan recent runs; if any effort beats what the current benchmark predicts, suggest an update.
function fitnessUpdateSuggestion(profile, runs) {
  if (!profile || !profile.benchDistKm || !profile.benchTimeSec) return null;
  let best = null;
  runs
    .filter((r) => withinDays(r.date, 35) && parseFloat(r.distance) >= 3 && r.timeSec > 0)
    .forEach((r) => {
      const predicted = riegel(profile.benchTimeSec, profile.benchDistKm, parseFloat(r.distance));
      if (r.timeSec < predicted * 0.98) {
        const gain = (predicted - r.timeSec) / predicted;
        if (!best || gain > best.gain) best = { run: r, gain };
      }
    });
  return best;
}

// Load watch: bucket runs into rolling 7-day weeks back from today, compare
// consecutive completed weeks, flag jumps over the threshold.
function loadWatch(runs) {
  const WEEKS = 5;            // how many weeks back to chart
  const THRESHOLD = 0.10;     // 10% week-over-week is the classic flag line
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;

  // weeks[0] = most recent 7 days, weeks[1] = 7-14 days ago, etc.
  const weeks = Array.from({ length: WEEKS }, () => 0);
  runs.forEach((r) => {
    const ageDays = (now - new Date(r.date).getTime()) / DAY;
    if (ageDays < 0) return;
    const bucket = Math.floor(ageDays / 7);
    if (bucket < WEEKS) weeks[bucket] += parseFloat(r.distance) || 0;
  });

  // current week (weeks[0]) is partial — don't flag against it yet.
  // compare last fully-elapsed week (weeks[1]) to the one before (weeks[2]).
  const prev = weeks[2];
  const last = weeks[1];
  const jump = prev > 0 ? (last - prev) / prev : null;
  const flagged = jump != null && jump > THRESHOLD;

  return { weeks, jump, flagged, last, prev };
}

const TYPE_WORD = { long: "long run", tempo: "tempo session", interval: "interval session", easy: "easy run" };

// Read last completed plan week vs. what got linked + how it felt, and turn it
// into one nudge for the week ahead. Advisory only — the plan is derived from
// profile, so this informs rather than rewrites it.
function weekReview(plan, profile, runs, completions) {
  if (!plan.length || !profile?.goalDate || !completions.length) return null;
  const cur = currentWeek(profile, plan);
  const lastNum = (cur ? cur.week : 1) - 1;
  if (lastNum < 1) return null;
  const lastWk = plan.find((w) => w.week === lastNum);
  if (!lastWk) return null;

  const doneDays = new Set(
    completions.filter((c) => c.planned_week === lastNum).map((c) => c.planned_day)
  );
  if (doneDays.size === 0) return null; // weren't tracking that week — stay quiet

  const sessions = lastWk.sessions.filter((s) => !s.skipped); // skipped = deliberate, not missed
  const total = sessions.length;
  const doneCount = sessions.filter((s) => doneDays.has(s.day)).length;
  const keySessions = sessions.filter((s) => s.type === "long" || s.quality);
  const missedKey = keySessions.filter((s) => !doneDays.has(s.day));

  const byId = new Map(runs.map((r) => [r.id, r]));
  const scores = completions
    .filter((c) => c.planned_week === lastNum)
    .map((c) => byId.get(c.activity_id))
    .filter((r) => r && r.score != null)
    .map((r) => r.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  if (missedKey.length) {
    const what = missedKey.length === 1 ? (TYPE_WORD[missedKey[0].type] || "session") : `${missedKey.length} key sessions`;
    return { tone: "warn", title: "Ease into this week", doneCount, total,
      msg: `You missed last week's ${what}. Don't stack this week on top to catch up — keep the progression gentle and let consistency do the work.` };
  }
  if (doneCount === total && (avg == null || avg >= 7)) {
    return { tone: "accent", title: "Strong week — keep rolling", doneCount, total,
      msg: `All ${total} sessions done${avg != null ? ` and feeling good (avg ${avg.toFixed(1)}/10)` : ""}. You're set to progress as planned.` };
  }
  if (avg != null && avg <= 5) {
    return { tone: "warn", title: "Hold steady this week", doneCount, total,
      msg: `You got ${doneCount}/${total} in, but they felt rough (avg ${avg.toFixed(1)}/10). Repeat rather than build this week, and back off further if it doesn't ease.` };
  }
  return { tone: "base", title: "On track", doneCount, total,
    msg: `Last week: ${doneCount}/${total} sessions done. Solid — aim to close the gap this week.` };
}

/* ---------- storage layer ---------- */

const KEYS = {
  profile: "stride:profile",
};

// Lazy browser Supabase client (instantiated on first use, client-side only).
let _sb = null;
function sb() {
  _sb = _sb || createClient();
  return _sb;
}

// --- profile <-> table mapping --------------------------------------------
// DB row (snake_case) -> app profile object (camelCase). goalLabel is derived,
// so it isn't stored; we rebuild it here so the app object keeps its shape.
function rowToProfile(row) {
  if (!row) return null;
  const goalDistanceKm = row.goal_distance_km != null ? Number(row.goal_distance_km) : null;
  const goalType = row.goal_type || "distance";
  const goalTime = row.goal_time || "";
  const goalLabel =
    goalType === "time" && goalTime
      ? `${goalDistanceKm}km in ${goalTime}`
      : `${goalDistanceKm}km`;
  return {
    name: row.name || "",
    goalType,
    goalDistanceKm,
    goalTime,
    goalLabel,
    goalMode: row.goal_mode || "race",
    goalDate: row.race_date || "",   // DB column stays race_date; app field is the general "goal date"    
    currentWeeklyKm: row.current_weekly_km != null ? Number(row.current_weekly_km) : null,
    daysPerWeek: row.days_per_week,
    planStartDate: row.plan_start_date || "",
    preferredDays: Array.isArray(row.preferred_days) ? row.preferred_days : [],
    longDay: row.long_day || "",
    scheduleOverrides: row.schedule_overrides && typeof row.schedule_overrides === "object" ? row.schedule_overrides : {},
    benchDistKm: row.bench_dist_km != null ? Number(row.bench_dist_km) : null,
    benchTimeSec: row.bench_time_s,
    easyPaceSec: row.easy_pace_s,
    lt1Hr: row.lt1_hr ?? null,
    lt2Hr: row.lt2_hr ?? null,
    lt2SourceActivity: row.lt2_source_activity ?? null,
    hrTestedAt: row.hr_tested_at ?? null,
  };
}
// app profile object -> DB row. Drops derived goalLabel; "" race date -> null.
function profileToRow(p, userId) {
  return {
    id: userId,
    name: p.name ?? null,
    goal_type: p.goalType ?? null,
    goal_distance_km: p.goalDistanceKm ?? null,
    goal_time: p.goalTime ?? null,
    goal_mode: p.goalMode || "race",
    race_date: p.goalDate ? p.goalDate : null,    
    current_weekly_km: p.currentWeeklyKm ?? null,
    days_per_week: p.daysPerWeek ?? null,
    plan_start_date: p.planStartDate ? p.planStartDate : null,
    preferred_days: p.preferredDays && p.preferredDays.length ? p.preferredDays : null,
    long_day: p.longDay ? p.longDay : null,
    schedule_overrides: p.scheduleOverrides ?? {},
    bench_dist_km: p.benchDistKm ?? null,
    bench_time_s: p.benchTimeSec ?? null,
    easy_pace_s: p.easyPaceSec ?? null,
    lt1_hr: p.lt1Hr ?? null,
    lt2_hr: p.lt2Hr ?? null,
    lt2_source_activity: p.lt2SourceActivity ?? null,
    hr_tested_at: p.hrTestedAt ?? null,
  };
}

// profile read/write. (runs/cross/fuel use their own functions above; plan is
// derived from profile, not stored. The localStorage branch is now unused but
// kept as a harmless generic fallback.)
async function loadKey(key, fallback) {
  if (key === KEYS.profile) {
    try {
      const supabase = sb();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return fallback;
      const { data, error } = await supabase
        .from("profile")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToProfile(data) : fallback;
    } catch (e) {
      console.error("load profile failed", e);
      return fallback;
    }
  }
  try {
    const r = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return r ? JSON.parse(r) : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  if (key === KEYS.profile) {
    try {
      const supabase = sb();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase
        .from("profile")
        .upsert(profileToRow(value, user.id), { onConflict: "id" });
      if (error) throw error;
    } catch (e) {
      console.error("save profile failed", e);
    }
    return;
  }
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("save failed", key, e);
  }
}

// --- runs: activities (objective) + run_logs (subjective), 1 run = 2 rows ----
// DB rows -> the flat run object the app expects. id = activity UUID (used for
// React keys and delete). distance kept as a 2dp string to match the app.
function rowsToRun(activity, log) {
  const d = activity.distance_km != null ? Number(activity.distance_km) : null;
  return {
    id: activity.id,
    date: (log && log.date) || (activity.date ? String(activity.date).slice(0, 10) : ""),
    type: (log && log.run_type) || activity.type || "easy",
    distance: d != null ? d.toFixed(2) : "0.00",
    timeSec: activity.moving_time_s ?? 0,
    score: log && log.score != null ? log.score : null,
    warmup: log ? !!log.warmup : false,
    wrong: (log && log.wrong) || [],
    pain: (log && log.pain) || [],
    notes: (log && log.notes) || "",
    avgHr: activity.avg_hr ?? null,
  };
}

async function loadRuns() {
  try {
    const supabase = sb();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    // activities is the spine; embed its run_log. newest first.
    const { data, error } = await supabase
      .from("activities")
      .select("*, run_logs(*)")
      .order("date", { ascending: false });
    if (error) throw error;
    return (data || []).map((a) => rowsToRun(a, a.run_logs && a.run_logs[0] ? a.run_logs[0] : null));
  } catch (e) {
    console.error("load runs failed", e);
    return [];
  }
}

// load one activity's full detail (all columns + its run_log) for the detail view.
async function loadActivityDetail(activityId) {
  try {
    const supabase = sb();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: act, error } = await supabase
      .from("activities")
      .select("*, run_logs(*)")
      .eq("id", activityId)
      .maybeSingle();
    if (error) throw error;
    if (!act) return null;
    return { activity: act, log: act.run_logs && act.run_logs[0] ? act.run_logs[0] : null };
  } catch (e) {
    console.error("load activity detail failed", e);
    return null;
  }
}

async function loadActivityStreams(activityId) {
  try {
    const supabase = sb();
    const { data, error } = await supabase
      .from("activity_streams")
      .select("streams")
      .eq("activity_id", activityId)
      .maybeSingle();
    if (error) throw error;
    return data ? data.streams : null;
  } catch (e) {
    console.error("load streams failed", e);
    return null;
  }
}

// Tracks played during one activity, oldest play first.
async function loadActivitySpotify(activityId) {
  try {
    const supabase = sb();
    const { data, error } = await supabase
      .from("spotify_plays")
      .select("*")
      .eq("activity_id", activityId)
      .order("played_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("load activity spotify failed", e);
    return [];
  }
}

// All plays for the user + the start date of each activity that has music, plus
// the cached streams for the most recent `cap` of those activities (so the
// per-moment HR/pace correlation has bounded payload). Returns null if signed
// out; { plays:[] } when there's simply no music yet.
async function loadSpotifyHistory(cap = 40) {
  try {
    const supabase = sb();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: plays, error } = await supabase
      .from("spotify_plays")
      .select("*")
      .order("played_at", { ascending: false });
    if (error) throw error;
    if (!plays || !plays.length) return { plays: [], dateById: {}, streamsById: {} };

    const ids = [...new Set(plays.map((p) => p.activity_id))];
    const { data: acts } = await supabase.from("activities").select("id,date").in("id", ids);
    const dateById = {};
    (acts || []).forEach((a) => { dateById[a.id] = a.date; });

    const recentIds = ids
      .filter((id) => dateById[id])
      .sort((a, b) => new Date(dateById[b]) - new Date(dateById[a]))
      .slice(0, cap);
    const { data: streamRows } = await supabase
      .from("activity_streams")
      .select("activity_id,streams")
      .in("activity_id", recentIds);
    const streamsById = {};
    (streamRows || []).forEach((s) => { streamsById[s.activity_id] = s.streams; });

    return { plays, dateById, streamsById };
  } catch (e) {
    console.error("load spotify history failed", e);
    return null;
  }
}

// --- music helpers (shared by the activity chart, setlist and insights) -----

// Place each play on the run's seconds-from-start axis. played_at is the track
// END, so start = end - duration. Sorted by start; sorted oldest→newest.
function buildSongSegs(plays, activityStartMs) {
  return (plays || [])
    .map((p) => {
      const endSec = (new Date(p.played_at).getTime() - activityStartMs) / 1000;
      const startSec = endSec - (p.duration_ms || 0) / 1000;
      return {
        id: p.track_id || p.played_at,
        name: p.track_name,
        artists: Array.isArray(p.artists) ? p.artists : [],
        art: p.album_art_url || null,
        uri: p.track_uri || null,
        startSec,
        endSec,
      };
    })
    .sort((a, b) => a.startSec - b.startSec);
}

// The track playing at time t (seconds): the segment covering t, else the most
// recently started one (covers small gaps between tracks).
function songAt(segs, t) {
  if (!segs || !segs.length || t == null) return null;
  let cur = null;
  for (const s of segs) {
    if (t >= s.startSec && t <= s.endSec) return s;
    if (s.startSec <= t) cur = s;
  }
  return cur;
}

function spotifyUrl(uri) {
  if (!uri) return null;
  const id = String(uri).split(":").pop();
  return id ? `https://open.spotify.com/track/${id}` : null;
}

// Estimate LT2 / LTHR from a 30-min test activity: average HR over the final 20 minutes
// of the heartrate stream. Returns { lt2, samples, durationS } or null if not enough data.
async function computeLt2FromActivity(activityId) {
  try {
    const streams = await loadActivityStreams(activityId);
    if (!streams) return null;
    const hr = streams.heartrate && (Array.isArray(streams.heartrate) ? streams.heartrate : streams.heartrate.data);
    const time = streams.time && (Array.isArray(streams.time) ? streams.time : streams.time.data);
    if (!hr || !time || hr.length < 2) return null;

    const endT = time[time.length - 1];
    const windowStart = endT - 20 * 60; // final 20 minutes
    let sum = 0, n = 0;
    for (let i = 0; i < hr.length; i++) {
      if (time[i] >= windowStart && hr[i] > 0) { sum += hr[i]; n++; }
    }
    if (n < 30) return null; // too few samples in the window to trust
    return { lt2: Math.round(sum / n), samples: n, durationS: endT };
  } catch (e) {
    console.error("computeLt2FromActivity failed", e);
    return null;
  }
}

// insert one run as activity (+ linked run_log); returns the flat run object.
async function insertRun(run) {
  const supabase = sb();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  const dist = Number(run.distance);
  const distanceKm = isFinite(dist) && dist > 0 ? dist : null;
  const timeS = run.timeSec ?? null;
  const avgPaceS = distanceKm && timeS ? timeS / distanceKm : null;

  const { data: act, error: e1 } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      date: run.date || null,
      type: run.type || null,
      distance_km: distanceKm,
      moving_time_s: timeS,
      avg_pace_s: avgPaceS,
      source: "manual",
    })
    .select()
    .single();
  if (e1) throw e1;

  const { data: log, error: e2 } = await supabase
    .from("run_logs")
    .insert({
      user_id: user.id,
      activity_id: act.id,
      date: run.date,
      run_type: run.type || null,
      score: run.score ?? null,
      warmup: !!run.warmup,
      wrong: run.wrong || [],
      pain: run.pain || [],
      notes: run.notes || null,
    })
    .select()
    .single();
  if (e2) throw e2;

  return rowsToRun(act, log);
}

// Attach or update the subjective "how it felt" layer on an existing activity.
// Inserts a run_log if none exists for this activity, updates it if one does.
async function saveRunLog(activityId, feel) {
  const supabase = sb();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");

  // pull the activity's date so the log isn't dateless
  const { data: act, error: eA } = await supabase
    .from("activities")
    .select("date")
    .eq("id", activityId)
    .single();
  if (eA) throw eA;
  const logDate = act.date ? String(act.date).slice(0, 10) : null;

  const { data: existing, error: e0 } = await supabase
    .from("run_logs")
    .select("id")
    .eq("activity_id", activityId)
    .maybeSingle();
  if (e0) throw e0;

  const row = {
    user_id: user.id,
    activity_id: activityId,
    date: logDate,
    run_type: feel.type ?? null,
    score: feel.score ?? null,
    warmup: !!feel.warmup,
    wrong: feel.wrong || [],
    pain: feel.pain || [],
    notes: feel.notes || null,
  };

  if (existing) {
    const { error } = await supabase.from("run_logs").update(row).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  } else {
    const { data, error } = await supabase.from("run_logs").insert(row).select("id").single();
    if (error) throw error;
    return data.id;
  }
}

// --- session completions: link a run to the planned slot it filled ----------
async function loadCompletion(activityId) {
  const supabase = sb();
  const { data, error } = await supabase
    .from("session_completions")
    .select("*")
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) {
    console.error("load completion failed", error);
    return null;
  }
  return data || null;
}
async function loadCompletions() {
  try {
    const supabase = sb();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("session_completions")
      .select("planned_week, planned_day, activity_id");
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("load completions failed", e);
    return [];
  }
}



async function saveCompletion(activityId, plannedWeek, plannedDay) {
  const supabase = sb();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { error } = await supabase
    .from("session_completions")
    .upsert(
      { activity_id: activityId, user_id: user.id, planned_week: plannedWeek, planned_day: plannedDay },
      { onConflict: "activity_id" }
    );
  if (error) throw error;
}

async function deleteCompletion(activityId) {
  const supabase = sb();
  const { error } = await supabase.from("session_completions").delete().eq("activity_id", activityId);
  if (error) throw error;
}

// Unlink every run from the (old) plan. Used when a new plan is generated —
// the old week/day slots no longer line up, so the linkages are wiped. The runs
// themselves (activities + run_logs) are untouched; only the plan linkage goes.
async function clearCompletions() {
  const supabase = sb();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("session_completions").delete().eq("user_id", user.id);
  if (error) console.error("clear completions failed", error);
}

// delete one run by activity id; run_log cascades via activity_id FK.
async function deleteRun(id) {
  const supabase = sb();
  const { error } = await supabase.from("activities").delete().eq("id", id);
  if (error) throw error;
}

// --- cross-training (single table; add + list, no delete in UI) ------------
function rowToCross(row) {
  return {
    id: row.id,
    date: row.date ? String(row.date).slice(0, 10) : "",
    activity: row.activity || "",
    minutes: row.minutes ?? null,
    intensity: row.intensity || "",
  };
}

async function loadCross() {
  try {
    const supabase = sb();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("cross_training")
      .select("*")
      .order("date", { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToCross);
  } catch (e) {
    console.error("load cross failed", e);
    return [];
  }
}

async function insertCross(x) {
  const supabase = sb();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const mins = x.minutes != null && x.minutes !== "" ? parseInt(x.minutes, 10) : null;
  const { data, error } = await supabase
    .from("cross_training")
    .insert({
      user_id: user.id,
      date: x.date,
      activity: x.activity || null,
      minutes: Number.isFinite(mins) ? mins : null,
      intensity: x.intensity || null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToCross(data);
}

// --- fuel: daily meal log in fuel_logs (single table; add + list) ----------
function rowToFuel(row) {
  return {
    id: row.id,
    date: row.date ? String(row.date).slice(0, 10) : "",
    breakfast: row.breakfast || "",
    lunch: row.lunch || "",
    dinner: row.dinner || "",
    snacks: row.snacks || "",
    water: row.water || "",
  };
}

async function loadFuel() {
  try {
    const supabase = sb();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("fuel_logs")
      .select("*")
      .order("date", { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToFuel);
  } catch (e) {
    console.error("load fuel failed", e);
    return [];
  }
}

async function insertFuel(f) {
  const supabase = sb();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { data, error } = await supabase
    .from("fuel_logs")
    .insert({
      user_id: user.id,
      date: f.date,
      breakfast: f.breakfast || null,
      lunch: f.lunch || null,
      dinner: f.dinner || null,
      snacks: f.snacks || null,
      water: f.water || null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToFuel(data);
}

/* ---------- small UI atoms ---------- */

const Stat = ({ label, value, accent }) => (
  <div className="stat">
    <div className="stat-val" style={accent ? { color: "var(--accent)" } : {}}>{value}</div>
    <div className="stat-label">{label}</div>
  </div>
);

const Pill = ({ children, tone }) => (
  <span className={`pill pill-${tone || "base"}`}>{children}</span>
);

// The session's prescription as a readable block — one row per step, with reps
// nested under their header. Renders from sessionSteps(), so it's the same data
// the description sentence is built from. Returns null for a plain steady run,
// where a one-row "breakdown" would say nothing the title doesn't.
function SessionSteps({ session, zones }) {
  const steps = sessionSteps(session);
  if (!hasSteps(session)) return null;
  return (
    <div className="step-list">
      {steps.map((st, i) => {
        if (st.kind === "reps") {
          return (
            <div key={i} className="step-row step-reps">
              <span className="step-dur">{st.reps} ×</span>
              <div className="step-main">
                <div className="step-rep-line">
                  <span className="step-rep-eff">{fmtTime(st.work.sec)} {st.work.label}</span>
                  <span className="step-pace">{stepPace(st.work, zones, "hard")}</span>
                </div>
                {stepEffort(st.work) && (
                  <div className="step-effort">{stepEffort(st.work)}</div>
                )}
                <div className="step-rep-line muted">
                  <span>{fmtTime(st.rest.sec)} {st.rest.label}</span>
                  <span className="step-pace">between efforts</span>
                </div>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className={`step-row step-${st.kind}`}>
            <span className="step-dur">{fmtTime(stepSeconds(st))}</span>
            <div className="step-main">
              <div className="step-rep-line">
                <span>{st.label}</span>
                <span className="step-pace">{stepPace(st, zones, "by feel")}</span>
              </div>
              {st.kind === "work" && stepEffort(st) && (
                <div className="step-effort">{stepEffort(st)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The same prescription as blocks to punch into a watch's custom-workout builder.
// Nothing can push a workout to an Apple Watch from a web app, so this is the
// next best thing: the concrete numbers, once, and the watch handles the alerts
// from then on. Durations resolve to a single buildable value — a builder can't
// take "20–25 min".
function WatchSetup({ session, zones }) {
  const [open, setOpen] = useState(false);
  if (!hasSteps(session)) return null;

  const blocks = [];
  sessionSteps(session).forEach((st) => {
    if (st.kind === "reps") {
      blocks.push({ name: "Work", sec: st.work.sec, target: stepPace(st.work, zones, "hard"), reps: st.reps });
      blocks.push({ name: "Recovery", sec: st.rest.sec, target: "", reps: st.reps });
      return;
    }
    blocks.push({
      name: st.kind === "warmup" ? "Warm-up" : st.kind === "cooldown" ? "Cool-down" : "Work",
      sec: stepSeconds(st, "mid"),
      target: st.kind === "work" ? stepPace(st, zones, "") : "",
    });
  });

  return (
    <div className="watch-setup">
      <button className="watch-toggle" onClick={() => setOpen(!open)}>
        <span>⌚ Build this on your watch</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <div className="watch-blocks">
            {blocks.map((b, i) => (
              <div key={i} className="watch-block">
                <span className="wb-name">{b.name}</span>
                <span className="wb-dur">{fmtTime(b.sec)}</span>
                <span className="wb-target">{b.target || "no target"}</span>
                <span className="wb-reps">{b.reps ? `×${b.reps}` : ""}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            Apple Watch: Workout → Outdoor Run → ⋯ → <strong>Custom</strong>. Add the blocks above and set
            a <strong>pace alert</strong> on the work block to that range — the watch buzzes when you drift
            out, so you never have to read pace mid-rep. Build it once; this session repeats all plan.
          </p>
        </>
      )}
    </div>
  );
}

// Circular progress ring (Apple-Activity style). Fills with how much of a
// target has been done; the arc is cobalt and turns positive-green once the
// target is hit. value/sub render stacked in the middle.
function ProgressRing({ pct, value, sub, size = 128, stroke = 13 }) {
  const p = Math.max(0, Math.min(1, pct || 0));
  const done = (pct || 0) >= 1;
  const cx = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const gid = done ? "ringDone" : "ringMain";
  const main = done ? "var(--positive)" : "var(--accent)";
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(p * 100)}% of weekly target`}>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: done ? "color-mix(in srgb, var(--positive) 55%, white)" : "color-mix(in srgb, var(--accent) 48%, white)" }} />
          <stop offset="100%" style={{ stopColor: main }} />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cx} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${(circ * p).toFixed(2)} ${circ.toFixed(2)}`}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${main} 50%, transparent))`, transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)" }}
      />
      <text className="ring-val" x={cx} y={cx - 2} textAnchor="middle">{value}</text>
      <text className="ring-sub" x={cx} y={cx + 16} textAnchor="middle">{sub}</text>
    </svg>
  );
}

/* ---------- main app ---------- */

// Bottom-nav items, left to right. Today sits in the center; its icon is the
// day-of-month tile rather than a glyph. `log` and `setup` are still valid tab
// values — log is reached from Today, setup from the top-right avatar.
const NAV_ITEMS = [
  ["plan", "Plan"],
  ["activity", "Activities"],
  ["today", "Today"],
  ["fuel", "Fuel"],
  ["insights", "Insights"],
];

// Inline nav glyphs — stroke follows the item's text colour via currentColor.
const NAV_ICONS = {
  plan: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  fuel: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 20V12M12 20V4M19 20v-6" />
    </svg>
  ),
};

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("today");
  const [profile, setProfile] = useState(null);
  const [plan, setPlan] = useState([]);
  const [runs, setRuns] = useState([]);
  const [cross, setCross] = useState([]);
  const [fuel, setFuel] = useState([]);
  const [completions, setCompletions] = useState([]); // plan↔run links, loaded with everything else
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  // Bumped on every realtime change so child views that hold their own data
  // (e.g. Today's completions) can re-fetch without a remount.

  /* --- URL <-> activity-detail sync (History API, see docs/UI_overhaul.md §2.4).
     Only the activity-detail dimension lives in the URL: /?activity=<uuid>.
     Tabs stay component state. --- */

  const openActivity = useCallback((id) => {
    setSelectedActivityId(id);
    setTab("activity");
    window.history.pushState({ strideActivity: id }, "", "/?activity=" + id);
  }, []);

  // In-app back from a detail. If we pushed the entry ourselves, pop it so the
  // browser stack stays honest; on a deep-link/refresh entry there is nothing
  // to pop, so just clean the URL in place.
  const closeActivity = useCallback(() => {
    if (window.history.state && window.history.state.strideActivity) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", "/");
      setSelectedActivityId(null);
    }
  }, []);

  // Leaving the activity context via the nav or brand: clear the selection and
  // strip the param without growing the history stack.
  const clearActivityParam = useCallback(() => {
    setSelectedActivityId(null);
    if (new URLSearchParams(window.location.search).get("activity")) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // Deep link on load (refresh / notification URL) + back/forward gestures.
  useEffect(() => {
    const syncFromUrl = () => {
      const id = new URLSearchParams(window.location.search).get("activity");
      if (id) {
        setSelectedActivityId(id);
        setTab("activity");
      } else {
        setSelectedActivityId(null);
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const reloadRuns = useCallback(async () => {
    const r = await loadRuns();
    setRuns(r);
  }, []);

  // Re-pull everything (runs, profile, cross, fuel). Used on mount and whenever
  // the app returns to the foreground, so a notification tap / app-switch shows
  // fresh data without a full close-and-reopen. Returns the profile so the
  // caller can decide on the first-load setup redirect.
  const refreshAll = useCallback(async () => {
    // Completions load here rather than inside Today/PlanView so the week review
    // and the done ✓s are present on first paint — fetching them per-tab meant
    // they popped in half a second late, after everything else had rendered.
    const [p, r, c, f, comp] = await Promise.all([
      loadKey(KEYS.profile, null),
      loadRuns(),
      loadCross(),
      loadFuel(),
      loadCompletions(),
    ]);
    setProfile(p);
    setPlan(p ? generatePlan(p) : []); // plan is derived from profile, not stored
    setRuns(r);
    setCross(c);
    setFuel(f);
    setCompletions(comp);
    return p;
  }, []);

  useEffect(() => {
    (async () => {
      const p = await refreshAll();
      setLoaded(true);
      if (!p) setTab("setup");
    })();
  }, [refreshAll]);

  // Refresh when the app comes back to the foreground — covers opening via a
  // push notification (the SW focuses the existing window, so React never
  // remounts on its own), plus returning from the app switcher or unlock.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAll]);

  // Live updates: subscribe to the user's own rows so changes made anywhere —
  // a run arriving via the Strava webhook, a link/score saved on another device
  // — refresh the UI without a manual reload. Realtime honours RLS, so we only
  // receive our own rows. Focus-refresh above remains the fallback. See
  // migration 014_realtime.sql (tables must be in the supabase_realtime pub).
  useEffect(() => {
    const supabase = sb();
    let channel;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      // refreshAll now pulls completions too, so it alone is the refresh signal.
      const bump = () => { refreshAll(); };
      const sub = (table) => ({ event: "*", schema: "public", table, filter: `user_id=eq.${user.id}` });
      channel = supabase
        .channel("stride-live")
        .on("postgres_changes", sub("activities"), bump)
        .on("postgres_changes", sub("run_logs"), bump)
        .on("postgres_changes", sub("session_completions"), bump)
        .on("postgres_changes", sub("activity_streams"), bump)
        .subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [refreshAll]);

  const zones = computeZones(profile);

  const saveProfile = useCallback((p) => {
    setProfile(p);
    saveKey(KEYS.profile, p);
    setPlan(generatePlan(p)); // derived, no longer persisted
  }, []);

  // Reschedule or skip a single planned session. value: an in-block ISO date
  // (moved), "skipped", or null (clear the override / un-skip). Stored on the
  // profile's scheduleOverrides map and persisted via saveProfile, which
  // regenerates the dated plan. See docs/ideas.md "Plan: flexibility".
  const setSessionSchedule = (week, origDay, value) => {
    if (!profile) return;
    const overrides = { ...(profile.scheduleOverrides || {}) };
    const key = `${week}:${origDay}`;
    if (value == null) delete overrides[key];
    else overrides[key] = value;
    saveProfile({ ...profile, scheduleOverrides: overrides });
  };

  // Count an already-logged run toward a planned session (the "you ran Tuesday,
  // was that Wednesday's tempo?" reconciliation). Upsert is keyed on the
  // activity, so a run can only ever hold one slot.
  const linkCompletion = useCallback(async (activityId, week, day) => {
    try {
      await saveCompletion(activityId, week, day);
      await refreshAll();
    } catch (e) {
      console.error("link completion failed", e);
    }
  }, [refreshAll]);

  const addRun = async (run) => {
    try {
      const saved = await insertRun(run);
      if (run.plannedWeek && run.plannedDay) {
        await saveCompletion(saved.id, run.plannedWeek, run.plannedDay);
      }
      setRuns((prev) => [saved, ...prev]);
      openActivity(saved.id); // open the new run on its detail page
    } catch (e) {
      console.error("add run failed", e);
    }
  };

  const updateFitness = (distKm, timeSec) => {
    const p = { ...profile, benchDistKm: distKm, benchTimeSec: timeSec };
    saveProfile(p);
  };

  const [paceToast, setPaceToast] = useState(null);

// Auto re-benchmark: when a synced run beats current paces, update silently.
useEffect(() => {
  if (!profile || !runs.length) return;
  const suggestion = fitnessUpdateSuggestion(profile, runs);
  if (!suggestion) return;
  const distKm = parseFloat(suggestion.run.distance);
  // guard: don't re-fire for a bench we already hold
  if (profile.benchDistKm === distKm && profile.benchTimeSec === suggestion.run.timeSec) return;
  updateFitness(distKm, suggestion.run.timeSec);
  setPaceToast({
    distKm,
    timeSec: suggestion.run.timeSec,
    gain: suggestion.gain,
  });
}, [runs, profile]);
  
  const delRun = async (id) => {
    try {
      await deleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("del run failed", e);
    }
  };
  const addCross = async (x) => {
    try {
      const saved = await insertCross(x);
      setCross((prev) => [saved, ...prev]);
    } catch (e) {
      console.error("add cross failed", e);
    }
  };
  const addFuel = async (f) => {
    try {
      const saved = await insertFuel(f);
      setFuel((prev) => [saved, ...prev]);
    } catch (e) {
      console.error("add fuel failed", e);
    }
  };

  if (!loaded)
    return (
      <div className="wrap"><StyleBlock /><div className="loading">Lacing up…</div></div>
    );

  return (
    <div className="wrap">
      <StyleBlock />
      <header className="topbar">
        <div className="brand" role="button" tabIndex={0} onClick={() => { setTab("today"); clearActivityParam(); }} style={{ cursor: "pointer" }}>
          <svg className="logo" viewBox="0 0 64 64" aria-label="Stride logo">
            <g fill="none" stroke="var(--accent)" strokeWidth="6.5" strokeLinecap="round">
              <path d="M16 24 L23 13" />
              <path d="M24 40 L35 23" />
              <path d="M32 56 L47 33" />
            </g>
          </svg>
          <span className="brand-word">STRIDE<span className="brand-dot">.</span></span>
        </div>
        <div className="top-right">
          {profile && profile.name ? <div className="hello">Hi, {profile.name}</div> : null}
          <button className="avatar-btn" aria-label="Setup" title="Setup" onClick={() => { setTab("setup"); clearActivityParam(); }}>
            {profile && profile.name ? profile.name.trim()[0].toUpperCase() : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV_ITEMS.map(([id, label]) => (
          <button
            key={id}
            className={`nav-item ${tab === id ? "nav-active" : ""}`}
            onClick={() => { setTab(id); clearActivityParam(); }}
          >
            {id === "today"
              ? <span className="nav-date">{String(new Date().getDate()).padStart(2, "0")}</span>
              : NAV_ICONS[id]}
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "today" && <Today profile={profile} plan={plan} runs={runs} zones={zones} go={setTab} onUpdateFitness={updateFitness} onReschedule={setSessionSchedule} onLinkRun={linkCompletion} completions={completions} />}
        {tab === "plan" && <PlanView plan={plan} zones={zones} profile={profile} runs={runs} onReschedule={setSessionSchedule} onOpenRun={openActivity} completions={completions} />}
        {tab === "log" && (
          <div className="stack">
            <button className="btn-ghost back-btn" onClick={() => setTab("today")}>‹ Back to today</button>
            <LogRun profile={profile} zones={zones} onSave={addRun} fuel={fuel} />
          </div>
        )}
        {tab === "activity" && (selectedActivityId
          ? <ActivityDetail activityId={selectedActivityId} profile={profile} onBack={closeActivity} onScored={reloadRuns} onDelete={async (id) => { await delRun(id); closeActivity(); }} />
          : <Activity runs={runs} cross={cross} onAddCross={addCross} onReloadRuns={reloadRuns} onOpenRun={openActivity} zones={zones} />)}
        {tab === "fuel" && <FuelView fuel={fuel} onSave={addFuel} runs={runs} />}
        {tab === "insights" && <Insights runs={runs} fuel={fuel} zones={zones} profile={profile} />}
        {tab === "setup" && <Setup profile={profile} onSave={saveProfile} zones={zones} runs={runs} onPlanReset={async () => { await clearCompletions(); reloadRuns(); }} />}
      </main>
       {paceToast && (
        <div className="toast" role="status">
          <span>
            Paces updated from your {paceToast.distKm}km in {fmtTime(paceToast.timeSec)} — about
            {" "}{Math.round(paceToast.gain * 100)}% quicker.
          </span>
          <button className="link-btn" onClick={() => setTab("setup")}>View pace history</button>
          <button className="toast-close" onClick={() => setPaceToast(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

/* ---------- TODAY ---------- */

function Today({ profile, plan, runs, zones, go, onUpdateFitness, onReschedule, onLinkRun, completions }) {
  const [noMatch, setNoMatch] = useState(() => new Set()); // sessions where the suggested run was waved off
  if (!profile) return <Empty msg="Head to Setup to get started." />;
  const review = weekReview(plan, profile, runs, completions);
  const wk = currentWeek(profile, plan);
  const last = runs[0];
  const weekKm = runs
    .filter((r) => withinDays(r.date, 7))
    .reduce((a, r) => a + (parseFloat(r.distance) || 0), 0);
  const fitness = fitnessUpdateSuggestion(profile, runs);

  // Weekly-target progress for the hub ring. Target = the km actually planned
  // for THIS week (sum of its sessions — quality sessions don't carry a km, so
  // we use the ~6km the volume math assumes for them). Filled = km from runs
  // the user has linked to this week's plan, so stray runs don't skew it.
  const runById = new Map(runs.map((r) => [r.id, parseFloat(r.distance) || 0]));
  const target = wk
    ? wk.sessions.filter((s) => !s.skipped).reduce((a, s) => a + plannedKm(s), 0)
    : 0;
  const weekLinkedKm = wk
    ? completions
        .filter((c) => c.planned_week === wk.week)
        .reduce((a, c) => a + (runById.get(c.activity_id) || 0), 0)
    : 0;
  const weekPct = target ? weekLinkedKm / target : 0;
  const weekRemain = target ? Math.max(0, target - weekLinkedKm) : 0;
  const doneSet = new Set(completions.map((c) => `${c.planned_week}:${c.planned_day}`));
  const wkSessions = wk ? wk.sessions.filter((s) => !s.skipped) : []; // skipped don't count toward the week
  const wkDone = wkSessions.filter((s) => doneSet.has(`${wk.week}:${s.day}`)).length;

  // Days this week that have been and gone unrun, plus the days still left to
  // move them onto and any casual run that might actually have been one of them.
  const today = todayISO();
  const overdue = overdueSessions(wk, doneSet, today);
  const daysLeft = wk
    ? Array.from({ length: 7 }, (_, k) => addDays(wk.weekStart, k)).filter((iso) => iso >= today)
    : [];
  const spareRuns = unlinkedRunsInWeek(wk, runs, completions);

  // Pair each stray run with the overdue session it most likely was, one run per
  // session (a completion is keyed on the activity, so a run can only fill one).
  const matched = new Map();
  if (wk && overdue.length) {
    spareRuns.forEach((r) => {
      const open = overdue.filter((s) => !matched.has(`${wk.week}:${s.origDay}`));
      const s = matchOverdueRun(open, r);
      if (s) matched.set(`${wk.week}:${s.origDay}`, r);
    });
  }

  return (
    <div className="stack">
      {overdue.length > 0 && (
        <section className="card review-card review-warn">
          <div className="card-head">
            <h3>{overdue.length === 1 ? "One run still open" : `${overdue.length} runs still open`}</h3>
            <Pill tone="warn">week {wk.week}</Pill>
          </div>
          <p className="muted small">
            The day has passed and nothing was logged against it. The plan leaves it where it is —
            move it to a day still to come this week, or skip it.
          </p>
          <div className="sessions" style={{ marginTop: 12 }}>
            {overdue.map((s) => {
              const key = `${wk.week}:${s.origDay}`;
              const d = sessionDescription(s, zones);
              const match = noMatch.has(key) ? null : matched.get(key);
              return (
                <div key={key} className="session-wrap">
                  <div className="session session-overdue">
                    <div className="session-day">
                      <span className="sd-dow">{dowName(s.date)}</span>
                      <span className="sd-num">{Number(s.date.slice(8, 10))}</span>
                    </div>
                    <div className="session-body">
                      <div className="session-title">{d.title}</div>
                      <div className="session-detail">Planned for {relDate(s.date)} · not logged</div>
                    </div>
                    <Pill tone="warn">overdue</Pill>
                  </div>
                  <div className="sess-editor">
                    {match ? (
                      // A run from this week that isn't linked to anything, close
                      // enough to have been this session. Offer it before the
                      // move/skip options — the run may already be done.
                      <>
                        <div className="sess-editor-lbl">Was this it?</div>
                        <p className="muted small" style={{ margin: "0 0 10px" }}>
                          You ran {relDate(match.date)} — {match.distance}km at {fmtPaceBare(paceOf(match))}/km —
                          and it isn’t counted toward any planned session.
                        </p>
                        <div className="sess-editor-actions">
                          <button className="btn-primary slim" onClick={() => onLinkRun(match.id, wk.week, s.day)}>
                            Count it toward this run
                          </button>
                          <button className="btn-ghost" onClick={() => setNoMatch((prev) => new Set(prev).add(key))}>
                            No, keep it casual
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {daysLeft.length > 0 ? (
                          <>
                            <div className="sess-editor-lbl">Move to</div>
                            <div className="day-picker">
                              {daysLeft.map((iso) => (
                                <button key={iso} className="day-chip" onClick={() => onReschedule(wk.week, s.origDay, iso)}>
                                  <span className="dc-dow">{dowName(iso)}</span>
                                  <span className="dc-num">{Number(iso.slice(8, 10))}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="muted small" style={{ margin: "0 0 8px" }}>
                            No days left this week. Skip it, or leave it — it’ll show as missed once the week closes.
                          </p>
                        )}
                        <div className="sess-editor-actions">
                          <button className="btn-ghost" onClick={() => onReschedule(wk.week, s.origDay, "skipped")}>
                            Skip this run
                          </button>
                          <button className="btn-ghost" onClick={() => go("log")}>Log a run</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {review && (
        <section className={`card review-card review-${review.tone}`}>
          <div className="card-head">
            <h3>{review.title}</h3>
            <Pill tone={review.tone}>{review.doneCount}/{review.total} last wk</Pill>
          </div>
          <p className="muted small">{review.msg}</p>
        </section>
      )}
      {fitness && (
        <section className="card fitness-banner">
          <div>
            <strong>You're getting faster.</strong>
            <p className="muted small">
              Your {fitness.run.distance}km in {fmtTime(fitness.run.timeSec)} ({fmtPace(paceOf(fitness.run))}) is about
              {" "}{Math.round(fitness.gain * 100)}% quicker than your current paces assume. Update them so your zones keep up.
            </p>
          </div>
          <button className="btn-primary slim" onClick={() => onUpdateFitness(parseFloat(fitness.run.distance), fitness.run.timeSec)}>
            Update my paces
          </button>
        </section>
      )}
      <section className="card hero">
        <div className="hero-row">
          <Stat label="Goal" value={profile.goalLabel || `${profile.goalDistanceKm}km`} accent />
          <Stat label={profile.goalMode === "fitness" ? "Target" : "Race day"} value={profile.goalDate ? daysUntil(profile.goalDate) + "d" : "—"} />
        </div>
      </section>

      {wk ? (
        <section className="card week-hub">
          <div className="card-head">
            <h3>This week</h3>
            <Pill tone="accent">Week {wk.week} · {wk.label}</Pill>
          </div>
          <div className="week-hub-row">
            <ProgressRing pct={weekPct} value={weekLinkedKm.toFixed(1)} sub={`of ${target} km`} />
            <div className="week-hub-side">
              <div className="wh-stat">
                <span className="wh-num" style={{ color: weekPct >= 1 ? "var(--positive)" : "var(--accent)" }}>{Math.round(weekPct * 100)}%</span>
                <span className="wh-lbl">of weekly target</span>
              </div>
              <div className="wh-stat">
                <span className="wh-num">{wkDone}/{wkSessions.length}</span>
                <span className="wh-lbl">sessions done</span>
              </div>
              <div className="wh-stat">
                <span className="wh-num">{weekRemain > 0 ? `${weekRemain.toFixed(1)}km` : "Done"}</span>
                <span className="wh-lbl">{weekRemain > 0 ? "still to run" : "target hit 🎉"}</span>
              </div>
            </div>
          </div>
          <div className="week-sessions">
            <div className="sessions">
              {wk.sessions.map((s, i) => {
                const d = sessionDescription(s, zones);
                const isDone = !s.skipped && doneSet.has(`${wk.week}:${s.day}`);
                const isLate = !s.skipped && !isDone && s.date < today;
                // Today's session gets its full breakdown inline — it's the one
                // you're about to run, so the steps beat a sentence.
                const isToday = s.date === today && !s.skipped && !isDone;
                // With the breakdown below it, the row's headline would just
                // repeat one of its lines — keep the duration and drop the rest.
                const showSteps = isToday && hasSteps(s);
                return (
                  <div key={i} className="session-wrap">
                    <div className={`session ${s.skipped ? "session-skipped" : ""} ${isLate ? "session-overdue" : ""} ${isToday ? "session-today" : ""}`}>
                      <div className="session-day">
                        <span className="sd-dow">{dowName(s.date)}</span>
                        <span className="sd-num">{Number(s.date.slice(8, 10))}</span>
                      </div>
                      <div className="session-body">
                        <div className="session-title">{d.title}</div>
                        <div className="session-detail">{showSteps && d.dur ? fmtDurRange(d.dur) : d.detail}</div>
                      </div>
                      {s.skipped && <Pill tone="base">skipped</Pill>}
                      {isLate && <Pill tone="warn">overdue</Pill>}
                      {isToday && <Pill tone="accent">today</Pill>}
                      {isDone && <span className="sess-mark done">✓</span>}
                    </div>
                    {showSteps && <SessionSteps session={s} zones={zones} />}
                    {showSteps && <WatchSetup session={s} zones={zones} />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <section className="card hero">
          <div className="hero-row">
            <Stat label="This week" value={`${weekKm.toFixed(1)}km`} accent />
          </div>
        </section>
      )}

      {last && (
        <section className="card">
          <div className="card-head"><h3>Last run</h3><span className="muted">{relDate(last.date)}</span></div>
          <div className="hero-row quad">
            <Stat label="Type" value={ZONE_META[last.type] ? ZONE_META[last.type].name.split(" ")[0] : last.type} />
            <Stat label="Distance" value={`${last.distance}km`} />
            <Stat label="Pace" value={fmtPaceBare(paceOf(last))} accent />
            <Stat label="Score" value={last.score != null ? `${last.score}/10` : "—"} accent />
          </div>
        </section>
      )}

      <button className="btn-primary" onClick={() => go("log")}>＋ Log a run</button>
    </div>
  );
}

/* ---------- guided warm-up ---------- */

// Movement-by-movement, each on its own timer — no jog. Order runs bottom-up
// (ankles → calves → hips → glutes) and ends on the fast, running-specific
// drills, so nothing sharp happens before the tissue is ready.
const WARMUP_STEPS = [
  { label: "Ankle bounces", sub: "Feet hip-width. Small, fast bounces off the balls of both feet — heels barely kissing the floor, knees soft.", sec: 30 },
  { label: "Calf raises", sub: "Full range, up onto the toes and slowly back down. Switch to one leg at a time for the last few.", sec: 45 },
  { label: "Leg swings — forward", sub: "Hand on a wall or post. Swing one leg front-to-back, loose, letting the range grow. Swap legs at halfway.", sec: 60 },
  { label: "Leg swings — across", sub: "Same hold, now swinging the leg side to side across your body. Keep the hips square. Swap at halfway.", sec: 60 },
  { label: "Walking lunges", sub: "Long step, back knee toward the floor, chest tall. Reach both arms overhead on each rep.", sec: 45 },
  { label: "Hip openers", sub: "Knee up to your chest, rotate it out to the side, then step through. Alternate — slow and controlled.", sec: 45 },
  { label: "Glute bridges", sub: "Squeeze hard at the top for a second, lower slowly. The muscle you most want awake before you run.", sec: 45 },
  { label: "High knees & heel flicks", sub: "30s knees up with quick feet, then 30s flicking your heels to your backside.", sec: 60 },
  { label: "A-skips", sub: "Skip with a driven knee and a tall posture. Light contacts, quick off the ground.", sec: 30 },
  { label: "Strides", sub: "4–6 × ~20s, building to fast-but-relaxed. Walk back to full recovery between each.", sec: 180 },
];

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 660; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) { /* no audio, no problem */ }
}

function WarmupTimer() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(WARMUP_STEPS[0].sec);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((l) => {
        if (l > 1) return l - 1;
        // advance
        setStep((s) => {
          if (s + 1 < WARMUP_STEPS.length) {
            beep();
            setLeft(WARMUP_STEPS[s + 1].sec);
            return s + 1;
          } else {
            beep();
            setRunning(false);
            setDone(true);
            return s;
          }
        });
        return 0;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const reset = () => { setRunning(false); setStep(0); setLeft(WARMUP_STEPS[0].sec); setDone(false); };
  const skip = () => {
    if (step + 1 < WARMUP_STEPS.length) { setStep(step + 1); setLeft(WARMUP_STEPS[step + 1].sec); }
    else { setRunning(false); setDone(true); }
  };

  if (!open)
    return <button className="btn-ghost wide" onClick={() => setOpen(true)}>▶ Start guided warm-up</button>;

  const cur = WARMUP_STEPS[step];
  return (
    <div className="warmup-timer">
      {done ? (
        <div className="wu-done">
          <div className="wu-time" style={{ color: "var(--accent)" }}>Warm. Ready.</div>
          <p className="muted small">Start your session now — the first km should already feel decent.</p>
          <button className="btn-ghost" onClick={reset}>Reset</button>
        </div>
      ) : (
        <>
          <div className="wu-steps">
            {WARMUP_STEPS.map((s, i) => (
              <span key={i} className={`wu-dot ${i === step ? "on" : i < step ? "past" : ""}`} />
            ))}
          </div>
          <div className="wu-label">{cur.label}</div>
          <div className="wu-time">{fmtTime(left)}</div>
          <div className="wu-sub muted">{cur.sub}</div>
          <div className="wu-controls">
            <button className="btn-primary slim" onClick={() => setRunning(!running)}>{running ? "Pause" : "Start"}</button>
            <button className="btn-ghost" onClick={skip}>Next step ▸</button>
            <button className="btn-ghost" onClick={reset}>Reset</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- PLAN ---------- */

function PlanView({ plan, zones, profile, runs, onReschedule, onOpenRun, completions }) {
  const [open, setOpen] = useState(null); // which week is expanded
  const [editing, setEditing] = useState(null); // "week:origDay" of the session being moved/skipped

  // "week:day" -> linked activity id (the run the user matched to this session)
  const links = new Map((completions || []).map((r) => [`${r.planned_week}:${r.planned_day}`, r.activity_id]));
  const runById = new Map((runs || []).map((r) => [r.id, r]));

  // Auto-expand the current week when the plan loads (plan identity is stable
  // between renders, so this fires on load/regeneration — not on user toggles).
  useEffect(() => {
    if (!profile || !plan.length) return;
    const c = currentWeek(profile, plan);
    if (c) setOpen(c.week);
  }, [profile, plan]);

  if (!profile) return <Empty msg="Set your goal in Setup to generate a plan." />;
  if (!plan.length) return <Empty msg="No plan yet — check your goal date in Setup." />;

  const planStart = profile.planStartDate || todayISO();
  const today = todayISO();
  const cur = currentWeek(profile, plan);
  const curNum = cur ? cur.week : 1;

  return (
    <div className="stack">
      <section className="card">
        <h3>{profile.goalLabel || `${profile.goalDistanceKm}km`} · {plan.length}-week plan</h3>
        <p className="muted">
          Built on the 80/20 principle: most running easy, a controlled dose of hard. Volume rises
          ~10%/week with a recovery week every 4th, then a taper. Tap a week, then a run to move or skip it.
        </p>
      </section>

      <section className="card warmup-card">
        <h3>🔑 Warm-up — do this before every hard session & race</h3>
        <WarmupTimer />
      </section>

      {plan.map((w) => {
        const active = w.sessions.filter((s) => !s.skipped);
        const total = active.length;
        const doneCount = active.filter((s) => links.has(`${w.week}:${s.day}`)).length;
        const isPast = w.week < curNum;
        const showCount = (isPast || w.week === curNum) && doneCount > 0;
        const range = `${fmtShortDate(w.weekStart)} – ${fmtShortDate(addDays(w.weekStart, 6))}`;
        const blockDays = Array.from({ length: 7 }, (_, k) => addDays(w.weekStart, k)).filter((iso) => iso >= planStart);
        return (
          <section key={w.week} className={`card week-card ${w.week === curNum ? "week-current" : ""}`}>
            <div className="card-head clickable" onClick={() => setOpen(open === w.week ? null : w.week)}>
              <div className="wk-head-l">
                <h3>Week {w.week} <span className="muted">· {w.label}</span></h3>
                <div className="muted small wk-range">{range}</div>
              </div>
              <div className="row-gap">
                {showCount && <Pill tone="base">{doneCount}/{total} done</Pill>}
                <span className="chev">{open === w.week ? "▾" : "▸"}</span>
              </div>
            </div>
            {open === w.week && (
              <div className="sessions">
                {w.sessions.map((s, i) => {
                  const d = sessionDescription(s, zones);
                  const linkedId = s.skipped ? null : links.get(`${w.week}:${s.day}`);
                  const linkedRun = linkedId != null ? runById.get(linkedId) : null;
                  const isDone = !!linkedId;
                  const isMissed = !s.skipped && isPast && !isDone;
                  // This week, a day that's been and gone without a run is
                  // overdue, not missed — there's still time to move it to a
                  // remaining day (or skip it) before the week closes out.
                  const isOverdue = !s.skipped && !isDone && w.week === curNum && s.date < today;
                  const key = `${w.week}:${s.origDay}`;
                  const isEditing = editing === key;
                  return (
                    <div key={i} className="session-wrap">
                      <div
                        className={`session clickable ${s.skipped ? "session-skipped" : ""} ${isOverdue ? "session-overdue" : ""}`}
                        onClick={() => setEditing(isEditing ? null : key)}
                      >
                        <div className="session-day">
                          <span className="sd-dow">{dowName(s.date)}</span>
                          <span className="sd-num">{Number(s.date.slice(8, 10))}</span>
                          <span className="sd-mon">{MONTHS[new Date(`${s.date}T12:00:00`).getMonth()]}</span>
                        </div>
                        <div className="session-body">
                          <div className="session-title">{d.title}</div>
                          <div className="session-detail">{d.detail}</div>
                        </div>
                        {s.skipped && <Pill tone="base">skipped</Pill>}
                        {isOverdue && <Pill tone="warn">overdue</Pill>}
                        {isDone && <span className="sess-mark done">✓</span>}
                        {isMissed && <span className="sess-mark miss">✕</span>}
                        <span className="sess-edit">{isEditing ? "▾" : "⋯"}</span>
                      </div>
                      {isEditing && (
                        <div className="sess-editor">
                          {linkedId ? (
                            // Linked to a logged run: it's settled, so moving/skipping
                            // no longer makes sense. Show a short recap + a jump to the
                            // activity, where it can be unlinked to free up these options.
                            <>
                              <div className="sess-editor-lbl">Logged run</div>
                              <div className="sess-linked muted small" style={{ margin: "0 0 8px" }}>
                                {linkedRun ? (
                                  <>{relDate(linkedRun.date)} · {linkedRun.distance}km · {fmtPaceBare(paceOf(linkedRun))}/km{linkedRun.score != null ? ` · ${linkedRun.score}/10` : ""}</>
                                ) : (
                                  <>This run is linked to a logged activity.</>
                                )}
                              </div>
                              <div className="sess-editor-actions">
                                <button className="btn-ghost" onClick={() => { onOpenRun(linkedId); }}>View in Activities ›</button>
                              </div>
                              <p className="muted small" style={{ margin: "8px 0 0" }}>To move or skip this run, unlink it from its activity first.</p>
                            </>
                          ) : (
                            <>
                              {!s.skipped && <SessionSteps session={s} zones={zones} />}
                              {!s.skipped && <WatchSetup session={s} zones={zones} />}
                              {s.skipped ? (
                                <p className="muted small" style={{ margin: "0 0 8px" }}>This run is skipped — it won't count toward your week.</p>
                              ) : (
                                <>
                                  {isOverdue && (
                                    <p className="muted small" style={{ margin: "0 0 10px" }}>
                                      {dowName(s.date)}’s run hasn’t been logged. Move it to a day still to come this
                                      week, or skip it.
                                    </p>
                                  )}
                                  <div className="sess-editor-lbl">Move to</div>
                                  <div className="day-picker">
                                    {blockDays.map((iso) => {
                                      // In the current week you can only move a run forward — a
                                      // day that's already gone can't be run on.
                                      const gone = w.week === curNum && iso < today;
                                      return (
                                        <button
                                          key={iso}
                                          className={`day-chip ${iso === s.date ? "on" : ""} ${gone ? "gone" : ""}`}
                                          disabled={gone}
                                          onClick={() => { onReschedule(w.week, s.origDay, iso); setEditing(null); }}
                                        >
                                          <span className="dc-dow">{dowName(iso)}</span>
                                          <span className="dc-num">{Number(iso.slice(8, 10))}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                              <div className="sess-editor-actions">
                                {s.skipped ? (
                                  <button className="btn-ghost" onClick={() => { onReschedule(w.week, s.origDay, null); setEditing(null); }}>Un-skip</button>
                                ) : (
                                  <button className="btn-ghost" onClick={() => { onReschedule(w.week, s.origDay, "skipped"); setEditing(null); }}>Skip this run</button>
                                )}
                                {(s.date !== dateForDayInWeek(w.weekStart, s.origDay) || s.skipped) && (
                                  <button className="btn-ghost" onClick={() => { onReschedule(w.week, s.origDay, null); setEditing(null); }}>Reset</button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------- LOG RUN ---------- */

const WRONG_OPTIONS = [
  "Started too fast", "Tired / low energy", "Breathing felt off",
  "Legs heavy / dead", "GI issues", "Too hot / humid",
  "Under-fuelled", "Poor sleep", "Stressed / distracted",
];
const RUN_TYPES = ["easy", "long", "tempo", "interval", "reps", "marathon", "race", "other"];

function LogRun({ profile, zones, onSave, fuel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [distance, setDistance] = useState("");
  const [time, setTime] = useState("");
  const [score, setScore] = useState(7);
  const [warmup, setWarmup] = useState(false);
  const [wrong, setWrong] = useState([]);
  const [pain, setPain] = useState([]);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const toggle = (arr, set, v) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const livePace = distance && time ? parseTime(time) / parseFloat(distance) : 0;

  // plan-linking on the log page: map the entered date to its plan week and
  // offer that week's sessions, with the same smart suggestion as the detail view.
  const plan = profile ? generatePlan(profile) : [];
  const wk = planWeekForDate(plan, date);
  const suggestedIdx = !selectedDay && wk
    ? suggestSessionIdx(wk.sessions, { date: `${date}T12:00:00`, distance_km: distance ? parseFloat(distance) : null })
    : -1;

  const submit = () => {
    if (!distance || !time) return;
    const sess = wk && selectedDay ? wk.sessions.find((s) => s.day === selectedDay) : null;
    onSave({
      id: Date.now(),
      date,
      type: sess ? sess.type : "run",
      distance: parseFloat(distance).toFixed(2),
      timeSec: parseTime(time),
      score: Number(score),
      warmup,
      wrong: score <= 6 ? wrong : [],
      pain,
      notes,
      plannedWeek: sess ? wk.week : null,
      plannedDay: sess ? sess.day : null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
    setDistance(""); setTime(""); setScore(7); setWrong([]); setPain([]); setNotes(""); setWarmup(false); setSelectedDay(null);
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>Log a run</h3>
        <div className="form-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Distance (km)</span>
            <input type="number" step="0.1" placeholder="e.g. 8.5" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </label>
          <label className="field">
            <span>Time (mm:ss or h:mm:ss)</span>
            <input type="text" placeholder="e.g. 48:30" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {livePace > 0 && (
          <div className="pace-readout">
            Pace: <strong>{fmtPace(livePace)}</strong>
          </div>
        )}
      </section>

      {wk && (
        <section className="card">
          <div className="card-head"><h3>Planned session</h3></div>
          <p className="muted small">Week {wk.week} · {wk.label} — link this run so it's typed, or skip it for an unplanned run.</p>
          <div className="sessions">
            {wk.sessions.map((s, i) => {
              const d = sessionDescription(s, zones);
              const on = selectedDay === s.day;
              const sug = !selectedDay && i === suggestedIdx;
              return (
                <button key={i} type="button" className={`session pick ${on ? "on" : ""}`} onClick={() => setSelectedDay(on ? null : s.day)}>
                  <div className="session-day">{s.day}</div>
                  <div className="session-body"><div className="session-title">{d.title}</div></div>
                  {sug && <Pill tone="accent">likely</Pill>}
                  {s.quality && <Pill tone="hard">quality</Pill>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h3>How did it feel?</h3><span className="score-big" style={{ color: scoreColor(score) }}>{score}/10</span></div>
        <input type="range" min="1" max="10" value={score} onChange={(e) => setScore(e.target.value)} className="slider" />
        <div className="slider-ends"><span>rough</span><span>effortless</span></div>

        <label className="check-row">
          <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
          <span>I warmed up first <span className="muted small">(easy jog + drills + strides before the hard part — the guided routine is on the Today tab)</span></span>
        </label>
      </section>

      {score <= 6 && (
        <section className="card">
          <h3>What went wrong?</h3>
          <div className="chips">
            {WRONG_OPTIONS.map((o) => (
              <button key={o} className={`chip ${wrong.includes(o) ? "chip-on" : ""}`} onClick={() => toggle(wrong, setWrong, o)}>{o}</button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <BodyMap
          selected={pain}
          onToggle={(a) => toggle(pain, setPain, a)}
          collapsible
          note="Logging this builds a picture over time. Persistent pain in one spot is worth showing a physio."
        />
      </section>

      <section className="card">
        <label className="field">
          <span>Notes</span>
          <textarea rows="3" placeholder="Weather, how you slept, anything else…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      <button className="btn-primary" onClick={submit} disabled={!distance || !time}>
        {saved ? "✓ Saved" : "Save run"}
      </button>
    </div>
  );
}

/* ---------- ACTIVITY (runs + cross-training) ---------- */

function Activity({ runs, cross, onAddCross, onReloadRuns, onOpenRun, zones }) {
  const [showCross, setShowCross] = useState(false);
  const [openOverride, setOpenOverride] = useState({});
  const nowYear = new Date().getFullYear();
  const now = new Date();
  const curKey = `${now.getFullYear()}-${now.getMonth()}`;

  // Merge runs and cross-training into one dated stream, newest first, then
  // group by month — mirroring the Plan tab's week cards.
  const items = [
    ...runs.map((r) => ({ kind: "run", date: r.date, t: new Date(r.date).getTime(), data: r })),
    ...cross.map((c) => ({ kind: "cross", date: c.date, t: new Date(c.date).getTime(), data: c })),
  ].sort((a, b) => b.t - a.t);

  const groups = [];
  items.forEach((it) => {
    const dt = new Date(it.date);
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const label = dt.toLocaleDateString(undefined, { month: "long" }) + (dt.getFullYear() !== nowYear ? ` ${dt.getFullYear()}` : "");
      g = { key, label, items: [], km: 0 };
      groups.push(g);
    }
    g.items.push(it);
    if (it.kind === "run" && parseFloat(it.data.distance) > 0) g.km += parseFloat(it.data.distance);
  });

  // Default-open the current month; if there's nothing logged this month yet,
  // fall back to the most recent group so the tab never opens fully collapsed.
  const hasCur = groups.some((g) => g.key === curKey);
  const defaultOpenKey = hasCur ? curKey : (groups[0] && groups[0].key);
  const isOpen = (key) => (key in openOverride ? openOverride[key] : key === defaultOpenKey);
  const toggleGroup = (key) => setOpenOverride((o) => ({ ...o, [key]: !isOpen(key) }));

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h3>Strava sync</h3>
          <SyncButton onDone={onReloadRuns} />
        </div>
        <p className="muted small">Pulls your latest activities, their details (splits, laps, effort) and stream data. Safe to run anytime — it only fetches what's new.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Cross-training</h3>
          <button className="btn-ghost" onClick={() => setShowCross(!showCross)}>{showCross ? "Close" : "＋ Add"}</button>
        </div>
        {showCross
          ? <CrossForm onAdd={(x) => { onAddCross(x); setShowCross(false); }} />
          : <p className="muted small">Pilates, swimming, cycling, strength — it all counts. Added sessions show in the monthly list below.</p>}
      </section>

      {groups.length === 0 && <Empty msg="No activities yet — sync Strava or add a cross-training session." />}

      {groups.map((g) => {
        const open = isOpen(g.key);
        const isCur = g.key === curKey;
        return (
          <section key={g.key} className={`card week-card ${isCur ? "week-current" : ""}`}>
            <div className="card-head clickable" onClick={() => toggleGroup(g.key)}>
              <div className="wk-head-l">
                <h3>{g.label}</h3>
              </div>
              <div className="row-gap">
                <span className="muted small">{g.items.length} {g.items.length === 1 ? "activity" : "activities"}{g.km > 0 ? ` · ${g.km.toFixed(0)}km` : ""}</span>
                <span className="chev">{open ? "▾" : "▸"}</span>
              </div>
            </div>
            {open && (
              <div className="sessions">
                {g.items.map((it) => {
                  if (it.kind === "cross") {
                    const c = it.data;
                    const di = isoDate(c.date);
                    return (
                      <div key={`c${c.id}`} className="session">
                        <div className="session-day">
                          <span className="sd-dow">{dowName(di)}</span>
                          <span className="sd-num">{Number(di.slice(8, 10))}</span>
                          <span className="sd-mon">{MONTHS[new Date(`${di}T12:00:00`).getMonth()]}</span>
                        </div>
                        <div className="session-body">
                          <div className="run-title-row">
                            <span className="session-title">{cap(c.activity)}</span>
                            <Pill tone="base">cross</Pill>
                          </div>
                          <div className="run-meta">{c.minutes}min · {c.intensity}</div>
                        </div>
                      </div>
                    );
                  }
                  const r = it.data;
                  const di = isoDate(r.date);
                  const hasDist = parseFloat(r.distance) > 0;
                  const hasFeel = (r.wrong && r.wrong.length > 0) || (r.pain && r.pain.length > 0);
                  return (
                    <div
                      key={`r${r.id}`}
                      className="session run-row clickable"
                      onClick={() => onOpenRun(r.id)}
                    >
                      <div className="session-day">
                        <span className="sd-dow">{dowName(di)}</span>
                        <span className="sd-num">{Number(di.slice(8, 10))}</span>
                        <span className="sd-mon">{MONTHS[new Date(`${di}T12:00:00`).getMonth()]}</span>
                      </div>
                      <div className="session-body">
                        <div className="session-title">{ZONE_META[r.type] ? ZONE_META[r.type].name : cap(r.type)}</div>
                        <div className="run-meta">{hasDist ? `${r.distance}km · ${fmtTime(r.timeSec)} · ${fmtPace(paceOf(r))}` : fmtTime(r.timeSec)}</div>
                        {hasFeel && (
                          <div className="run-feel">
                            {r.wrong && r.wrong.length > 0 && <span className="muted small">{r.wrong.join(", ")}</span>}
                            {r.pain && r.pain.length > 0 && <span className="pain-tag">{r.wrong && r.wrong.length > 0 ? " · " : ""}🩹 {r.pain.join(", ")}</span>}
                          </div>
                        )}
                        {r.notes && <div className="run-notes">"{r.notes}"</div>}
                      </div>
                      <div className="run-score-cell">
                        {r.score != null
                          ? <span className="run-score" style={{ color: scoreColor(r.score) }}>{r.score}/10</span>
                          : <span className="muted small">score</span>}
                        <span className="sess-edit">›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ActivityDetail({ activityId, onBack, profile, onScored, onDelete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streams, setStreams] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [plays, setPlays] = useState([]);
  const [focusT, setFocusT] = useState(null); // chart time pinned from the setlist
  const [reloadTick, setReloadTick] = useState(0);
  const chartRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFocusT(null);
    Promise.all([loadActivityDetail(activityId), loadActivityStreams(activityId), loadCompletion(activityId), loadActivitySpotify(activityId)])
      .then(([d, s, c, p]) => {
        if (alive) {
          setData(d); setStreams(s); setCompletion(c); setPlays(p || []); setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [activityId, reloadTick]);

  if (loading) return <div className="card empty">Loading activity…</div>;
  if (!data)
    return (
      <div className="stack">
        <button className="btn-ghost back-btn" onClick={onBack}>‹ Back</button>
        <div className="card empty">Couldn't load this activity.</div>
      </div>
    );

  const a = data.activity;
  const log = data.log;
  const dist = a.distance_km != null ? Number(a.distance_km) : null;
  const pace = a.avg_pace_s != null ? Number(a.avg_pace_s) : (dist && a.moving_time_s ? a.moving_time_s / dist : null);
  const splits = Array.isArray(a.splits) ? a.splits : [];
  const laps = Array.isArray(a.laps) ? a.laps : [];
  const best = Array.isArray(a.best_efforts) ? a.best_efforts : [];
  const typeName = ZONE_META[a.type] ? ZONE_META[a.type].name : cap(a.type || "Run");
  const dateStr = a.date
    ? new Date(a.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";

  const activityStartMs = a.date ? new Date(a.date).getTime() : 0;
  const songSegs = activityStartMs ? buildSongSegs(plays, activityStartMs) : [];
  const jumpToSong = (seg) => {
    setFocusT(Math.max(0, seg.startSec));
    if (chartRef.current) chartRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="stack">
      <button className="btn-ghost back-btn" onClick={onBack}>‹ Back to activity</button>

      <section className="card hero">
        <div className="card-head"><h3>{typeName}</h3><span className="muted">{dateStr}</span></div>
        <div className="hero-row">
          {dist != null && dist > 0 && <Stat label="Distance" value={`${dist.toFixed(2)}km`} accent />}
          <Stat label="Moving" value={fmtTime(a.moving_time_s)} />
          {dist != null && dist > 0 && <Stat label="Pace" value={fmtPaceBare(pace)} accent />}
        </div>
        <div className="hero-row" style={{ marginTop: 10 }}>
          <Stat label="Avg HR" value={a.avg_hr ? String(a.avg_hr) : "—"} />
          <Stat label="Max HR" value={a.max_hr ? String(a.max_hr) : "—"} />
          <Stat label="Elev gain" value={a.elevation_m != null ? `${Math.round(a.elevation_m)}m` : "—"} />
          <Stat label="Effort" value={a.relative_effort != null ? `${a.relative_effort}` : "—"} />        
        </div>
        {(a.gear_name || a.device_name || a.calories || a.avg_cadence) && (
          <div className="detail-meta muted small">
            {a.gear_name && <span>👟 {a.gear_name}</span>}
            {a.avg_cadence && <span>🦶 {Math.round(a.avg_cadence * 2)} spm</span>}
            {a.calories && <span>🔥 {Math.round(a.calories)} cal</span>}
            {a.device_name && <span>⌚ {a.device_name}</span>}
          </div>
        )}
        {a.description && <p className="muted small" style={{ marginTop: 10 }}>"{a.description}"</p>}
      </section>

      <div ref={chartRef}>
        <StreamChart streams={streams} songSegs={songSegs} focusT={focusT} onClearFocus={() => setFocusT(null)} />
      </div>

      <Setlist segs={songSegs} onJump={jumpToSong} />

      {streams && (() => {
        const ll = streams.latlng && (Array.isArray(streams.latlng) ? streams.latlng : streams.latlng.data);
        return ll && ll.length > 1 ? (
          <section className="card">
            <h3>Route</h3>
            <RouteMap latlng={ll} />
          </section>
        ) : null;
      })()}

      <HRZoneBreakdown streams={streams} lt1={profile?.lt1Hr} lt2={profile?.lt2Hr} />

      {splits.length > 0 && (
        <section className="card">
          <h3>Splits</h3>
          <div className="splits-table">
            <div className="srow shead"><span>Km</span><span>Pace</span><span>HR</span><span>Elev</span></div>
            {splits.map((s, i) => {
              const sp = s.average_speed ? 1000 / s.average_speed : null;
              return (
                <div key={i} className="srow">
                  <span>{s.split ?? i + 1}</span>
                  <span className="mono">{fmtPace(sp)}</span>
                  <span className="mono">{s.average_heartrate ? Math.round(s.average_heartrate) : "—"}</span>
                  <span className="mono">{s.elevation_difference != null ? `${s.elevation_difference > 0 ? "+" : ""}${Math.round(s.elevation_difference)}m` : "—"}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {best.length > 0 && (
        <section className="card">
          <h3>Best efforts this run</h3>
          {best.map((b, i) => (
            <div key={i} className="row-item"><span>{b.name}</span><span className="mono">{fmtTime(b.elapsed_time ?? b.moving_time)}</span></div>
          ))}
        </section>
      )}

      {laps.length > 1 && (
        <section className="card">
          <h3>Laps</h3>
          <div className="splits-table">
            <div className="srow shead"><span>Lap</span><span>Dist</span><span>Pace</span><span>HR</span></div>
            {laps.map((l, i) => {
              const ld = l.distance != null ? l.distance / 1000 : null;
              const lp = l.average_speed ? 1000 / l.average_speed : null;
              return (
                <div key={i} className="srow">
                  <span>{l.lap_index ?? i + 1}</span>
                  <span className="mono">{ld != null ? ld.toFixed(2) : "—"}</span>
                  <span className="mono">{fmtPace(lp)}</span>
                  <span className="mono">{l.average_heartrate ? Math.round(l.average_heartrate) : "—"}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <PaceInsights pace={pace} splits={splits} completion={completion} profile={profile} />
      <LinkSession activity={a} log={log} completion={completion} profile={profile} onSaved={() => setReloadTick((t) => t + 1)} />
      <ScoreCard activity={a} log={log} onSaved={() => { setReloadTick((t) => t + 1); onScored?.(); }} />

      {onDelete && (
        <section className="card">
          <div className="run-foot">
            <button className="del" onClick={() => { if (window.confirm("Delete this activity? This can't be undone.")) onDelete(activityId); }}>Delete activity</button>
          </div>
        </section>
      )}
    </div>
  );
}

function buildSeries(streams) {
  if (!streams) return null;
  const get = (k) => (streams[k] && Array.isArray(streams[k].data) ? streams[k].data : null);
  const time = get("time");
  if (!time) return null;
  const hr = get("heartrate"), vel = get("velocity_smooth"), alt = get("altitude"), cad = get("cadence");
  const n = time.length;
  const step = Math.max(1, Math.ceil(n / 300));   // decimate to ~300 points
  const points = [];
  for (let i = 0; i < n; i += step) {
    const v = vel ? vel[i] : null;
    points.push({
      t: time[i],
      hr: hr ? hr[i] : null,
      pace: v && v > 0.5 ? 1000 / v : null,        // s/km; drop near-stops so pace doesn't spike
      elev: alt ? alt[i] : null,
      cad: cad ? Math.round(cad[i] * 2) : null,    // per-leg RPM → spm
    });
  }
  return { points, has: { hr: !!hr, pace: !!vel, elev: !!alt, cad: !!cad } };
}

// Album art + title + artist, reused in the tooltip, the focus pin and the setlist.
function SongCell({ seg, sub }) {
  if (!seg) return null;
  return (
    <div className="song-cell">
      {seg.art
        ? <img className="song-art" src={seg.art} alt="" />
        : <div className="song-art song-art-ph">♪</div>}
      <div className="song-meta">
        <div className="song-title">{seg.name}</div>
        <div className="song-artist muted small">{seg.artists.join(", ")}{sub ? ` · ${sub}` : ""}</div>
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, songSegs }) {
  if (!active || !payload || !payload.length) return null;
  const v = {};
  payload.forEach((p) => { v[p.dataKey] = p.value; });
  const song = songSegs ? songAt(songSegs, label) : null;
  return (
    <div className="chart-tip-wrap">
      <div className="chart-tip">
        <div className="chart-tip-t">{fmtTime(label)}</div>
        {v.hr != null && <div><span style={{ color: "var(--viz-b)" }}>HR</span> {Math.round(v.hr)} bpm</div>}
        {v.pace != null && <div><span style={{ color: "var(--accent)" }}>Pace</span> {fmtPace(v.pace)}</div>}
        {v.elev != null && <div><span style={{ color: "var(--muted)" }}>Elev</span> {Math.round(v.elev)} m</div>}
        {v.cad != null && <div><span style={{ color: "var(--amber)" }}>Cadence</span> {v.cad} spm</div>}
      </div>
      {songSegs && (
        <div className="chart-tip chart-tip-song">
          {song ? <SongCell seg={song} /> : <span className="muted small">No track here</span>}
        </div>
      )}
    </div>
  );
}

function StreamChart({ streams, songSegs, focusT, onClearFocus }) {
  const series = buildSeries(streams);
  const [show, setShow] = useState({ hr: true, pace: true, elev: true, cad: false });
  const [tunes, setTunes] = useState(false);
  if (!series || series.points.length < 2) return null;
  const { points, has } = series;
  const hasTunes = songSegs && songSegs.length > 0;
  const maxT = points.length ? points[points.length - 1].t : 0;
  const tickStep = maxT > 5400 ? 1200 : maxT > 2400 ? 600 : 300; // >90min→20m, >40min→10m, else 5m
  const ticks = [];
  for (let s = 0; s <= maxT; s += tickStep) ticks.push(s);
  const toggles = [
    ["hr", "HR", "var(--viz-b)"], ["pace", "Pace", "var(--accent)"],
    ["elev", "Elevation", "var(--muted)"], ["cad", "Cadence", "var(--amber)"],
  ].filter(([k]) => has[k]);

  const focusSong = focusT != null && hasTunes ? songAt(songSegs, focusT) : null;
  const focusPt = focusT != null
    ? points.reduce((best, p) => (best == null || Math.abs(p.t - focusT) < Math.abs(best.t - focusT) ? p : best), null)
    : null;

  return (
    <section className="card">
      <h3>Over the run</h3>
      <div className="chips" style={{ marginBottom: 10 }}>
        {toggles.map(([k, label, color]) => (
          <button key={k} className={`chip ${show[k] ? "chip-on" : ""}`} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}>
            <span className="dot" style={{ background: color }} />{label}
          </button>
        ))}
        {hasTunes && (
          <button className={`chip ${tunes ? "chip-on" : ""}`} onClick={() => setTunes((t) => !t)}>
            <span className="dot" style={{ background: "var(--positive)" }} />Tunes
          </button>
        )}
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[0, maxT]} ticks={ticks} tickFormatter={fmtTime} tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--line)" />            <YAxis yAxisId="hr" domain={["auto", "auto"]} hide />
            <YAxis yAxisId="pace" reversed domain={["auto", "auto"]} hide />
            <YAxis yAxisId="elev" domain={["auto", "auto"]} hide />
            <YAxis yAxisId="cad" domain={["auto", "auto"]} hide />
            <Tooltip content={(p) => <ChartTip {...p} songSegs={tunes && hasTunes ? songSegs : null} />} />
            {focusT != null && <ReferenceLine yAxisId="hr" x={focusT} stroke="var(--accent)" strokeDasharray="4 3" />}
            {has.elev && show.elev && <Area yAxisId="elev" dataKey="elev" stroke="none" fill="var(--muted)" fillOpacity={0.18} isAnimationActive={false} connectNulls />}
            {has.pace && show.pace && <Line yAxisId="pace" dataKey="pace" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />}
            {has.hr && show.hr && <Line yAxisId="hr" dataKey="hr" stroke="var(--viz-b)" dot={false} strokeWidth={2} isAnimationActive={false} connectNulls />}
            {has.cad && show.cad && <Line yAxisId="cad" dataKey="cad" stroke="var(--amber)" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {focusT != null && (
        <div className="chart-pin">
          <div className="chart-pin-data">
            <strong className="mono">{fmtTime(focusT)}</strong>
            {focusPt && focusPt.hr != null && <span><span style={{ color: "var(--viz-b)" }}>HR</span> {Math.round(focusPt.hr)}</span>}
            {focusPt && focusPt.pace != null && <span><span style={{ color: "var(--accent)" }}>Pace</span> {fmtPace(focusPt.pace)}</span>}
            <button className="pin-close" onClick={onClearFocus} aria-label="Clear">✕</button>
          </div>
          {focusSong && <SongCell seg={focusSong} />}
        </div>
      )}
    </section>
  );
}

// The run's tracks in order, with their time into the run. Tap to jump the
// chart to that moment; the icon opens the track in Spotify.
function Setlist({ segs, onJump }) {
  if (!segs || !segs.length) return null;
  return (
    <section className="card">
      <h3>Soundtrack <span className="muted small">· {segs.length} {segs.length === 1 ? "track" : "tracks"}</span></h3>
      <p className="muted small">In order of play. Tap a track to jump to that point on the chart.</p>
      <div className="setlist">
        {segs.map((s, i) => {
          const url = spotifyUrl(s.uri);
          return (
            <div key={i} className="setlist-row">
              <button className="setlist-main" onClick={() => onJump(s)}>
                <span className="setlist-time mono">{fmtTime(Math.max(0, Math.round(s.startSec)))}</span>
                <SongCell seg={s} />
              </button>
              {url && (
                <a className="setlist-spotify" href={url} target="_blank" rel="noreferrer" title="Open in Spotify">Spotify ↗</a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScoreCard({ activity, log, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState(log?.score ?? 7);
  const [warmup, setWarmup] = useState(log?.warmup ?? false);
  const [wrong, setWrong] = useState(log?.wrong ?? []);
  const [pain, setPain] = useState(log?.pain ?? []);
  const [notes, setNotes] = useState(log?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const startEdit = () => {
    setScore(log?.score ?? 7); setWarmup(log?.warmup ?? false);
    setWrong(log?.wrong ?? []); setPain(log?.pain ?? []); setNotes(log?.notes ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveRunLog(activity.id, {
        type: (log && log.run_type) || activity.type || null,
        score: Number(score),
        warmup,
        wrong: score <= 6 ? wrong : [],
        pain: pain,
        notes,
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      console.error("save score failed", e);
      alert("Couldn't save — try again.");
    }
    setSaving(false);
  };

  // ---- saved (read) state ----
  if (!editing) {
    const scored = log && log.score != null;
    return (
      <section className="card">
        <div className="card-head">
          <h3>How it felt</h3>
          <button className="btn-ghost" onClick={startEdit}>{scored ? "Edit" : "Score this run"}</button>
        </div>
        {scored ? (
          <>
            <div className="hero-row">
              <Stat label="Score" value={`${log.score}/10`} accent />
              {log.warmup && <Stat label="Warm-up" value="Yes" />}
            </div>
            {log.wrong && log.wrong.length > 0 && <p className="muted small">Flagged: {log.wrong.join(", ")}</p>}
            {log.pain && log.pain.length > 0 && <p className="pain-tag small">🩹 {log.pain.join(", ")}</p>}
            {log.notes && <p className="run-notes">"{log.notes}"</p>}
          </>
        ) : (
          <p className="muted small">Strava captured the numbers — add how it actually felt.</p>
        )}
      </section>
    );
  }

  // ---- editing state ----
  return (
    <section className="card">
      <div className="card-head">
        <h3>How did it feel?</h3>
        <span className="score-big" style={{ color: scoreColor(score) }}>{score}/10</span>
      </div>
      <input type="range" min="1" max="10" value={score} onChange={(e) => setScore(e.target.value)} className="slider" />
      <div className="slider-ends"><span>rough</span><span>effortless</span></div>

      <label className="check-row">
        <input type="checkbox" checked={warmup} onChange={(e) => setWarmup(e.target.checked)} />
        <span>I warmed up first</span>
      </label>

      {score <= 6 && (
        <>
          <h4 className="sub-h">What went wrong?</h4>
          <div className="chips">
            {WRONG_OPTIONS.map((o) => (
              <button key={o} className={`chip ${wrong.includes(o) ? "chip-on" : ""}`} onClick={() => toggle(wrong, setWrong, o)}>{o}</button>
            ))}
          </div>
        </>
      )}

      <BodyMap selected={pain} onToggle={(a) => toggle(pain, setPain, a)} collapsible/>

      <label className="field" style={{ marginTop: 12 }}>
        <span>Notes</span>
        <textarea rows="3" placeholder="How you slept, weather, anything else…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="row-gap" style={{ marginTop: 12 }}>
        <button className="btn-primary slim" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
      </div>
    </section>
  );
}

// Pace adherence for a run that's been LINKED to a planned session. Unlinked
// runs show nothing here (just the "Link to plan" tile). Easy/long runs are
// always conversational, so we only flag running TOO HARD; quality sessions get
// the full whole-run + per-km breakdown against the planned pace band.
function PaceInsights({ pace, splits, completion, profile }) {
  if (!completion) return null;
  const zones = computeZones(profile);
  const plan = profile ? generatePlan(profile) : [];
  const wk = plan.find((w) => w.week === completion.planned_week);
  const session = wk && wk.sessions.find((s) => s.day === completion.planned_day);
  const type = session ? session.type : null;
  const band = type && zones ? zones[type] : null;
  if (!type || !band || !pace) return null;
  const [slow, fast] = band; // sec/km; slow end is the larger number

  // Easy / long: conversational by definition. The only meaningful miss is
  // going faster than the top of the easy range — flag that, praise the rest.
  if (type === "easy" || type === "long") {
    const tooHard = pace < fast;
    return (
      <section className="card">
        <div className="card-head">
          <h3>Pace check</h3>
          <Pill tone={tooHard ? "warn" : "accent"}>{tooHard ? "ran hot" : "kept it easy"}</Pill>
        </div>
        {tooHard ? (
          <p className="muted small">
            You averaged {fmtPace(pace)} — about {fmtPaceDelta(fast - pace)}/km quicker than the top of your easy range ({fmtPace(fast)}).
            Easy days do their job only when they stay genuinely easy; ease off and let these be recovery.
          </p>
        ) : (
          <p className="muted small">
            You averaged {fmtPace(pace)}, comfortably within easy effort. Nicely controlled — exactly how easy and long runs should feel.
          </p>
        )}
      </section>
    );
  }

  // Quality (tempo / interval): whole-run summary + per-km vs the target band.
  const verdict = pace <= slow && pace >= fast ? "on target" : pace < fast ? "faster than target" : "slower than target";
  const km = splits.map((s, i) => {
    const sp = s.average_speed ? 1000 / s.average_speed : null;
    const tone = sp == null ? "" : sp < fast ? "fast" : sp > slow ? "slow" : "on";
    return { n: s.split ?? i + 1, sp, tone };
  });
  return (
    <section className="card">
      <div className="card-head">
        <h3>Pace vs plan</h3>
        <Pill tone="base">{cap(type)}</Pill>
      </div>
      <div className="hero-row">
        <Stat label="Your avg" value={fmtPaceBare(pace)} accent />
        <Stat label="Target" value={`${fmtPaceBare(slow)}–${fmtPaceBare(fast)}`} />
        <Stat label="Verdict" value={verdict} />
      </div>
      {km.length > 0 && (
        <div className="splits-table" style={{ marginTop: 10 }}>
          <div className="srow shead"><span>Km</span><span>Pace</span><span>vs plan</span></div>
          {km.map((k) => (
            <div key={k.n} className="srow">
              <span>{k.n}</span>
              <span className="mono">{fmtPace(k.sp)}</span>
              <span
                className={`mono ${k.tone === "slow" ? "muted" : ""}`}
                style={k.tone === "on" ? { color: "var(--positive)" } : k.tone === "fast" ? { color: "var(--accent)" } : undefined}
              >
                {k.tone === "on" ? "on target" : k.tone === "fast" ? "faster" : k.tone === "slow" ? "easier" : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Warm-up and cool-down kms read “easier” than target — that’s expected; the work intervals are where it counts.
      </p>
    </section>
  );
}

function LinkSession({ activity, log, completion, profile, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const plan = profile ? generatePlan(profile) : [];
  const wk = planWeekForDate(plan, activity.date);

  const link = async (s) => {
    setSaving(true);
    try {
      await saveCompletion(activity.id, wk.week, s.day);
      await saveRunLog(activity.id, {
        type: s.type,
        score: log?.score ?? null,
        warmup: log?.warmup ?? false,
        wrong: log?.wrong ?? [],
        pain: log?.pain ?? [],
        notes: log?.notes ?? "",
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      console.error("link session failed", e);
      alert("Couldn't link — try again.");
    }
    setSaving(false);
  };

  const unlink = async () => {
    setSaving(true);
    try {
      await deleteCompletion(activity.id);
      onSaved();
    } catch (e) {
      console.error("unlink failed", e);
      alert("Couldn't unlink — try again.");
    }
    setSaving(false);
  };

  if (!profile || !profile.goalDate || !wk) {
    return (
      <section className="card">
        <div className="card-head"><h3>Planned session</h3></div>
        <p className="muted small">Set a goal date in Setup to match runs to your plan.</p>
      </section>
    );
  }

  const suggestedIdx = completion ? -1 : suggestSessionIdx(wk.sessions, activity);
  const suggested = suggestedIdx >= 0 ? wk.sessions[suggestedIdx] : null;

  if (!editing) {
    const t = log && log.run_type;
    const typeName = t ? (ZONE_META[t] ? ZONE_META[t].name.split(" ")[0] : cap(t)) : "—";
    return (
      <section className="card">
        <div className="card-head">
          <h3>Planned session</h3>
          <button className="btn-ghost" onClick={() => setEditing(true)}>{completion ? "Change" : "Link to plan"}</button>
        </div>
        {completion ? (
          <div className="hero-row">
            <Stat label="Week" value={`W${completion.planned_week}`} />
            <Stat label="Day" value={completion.planned_day} />
            <Stat label="Type" value={typeName} accent />
          </div>
        ) : suggested ? (
          <p className="muted small">Looks like <strong>{sessionDescription(suggested, null).title}</strong> ({suggested.day}). Tap "Link to plan" to confirm — or pick another.</p>
        ) : (
          <p className="muted small">Not linked yet. Linking sets this run's type (easy, tempo…) so it counts in your insights.</p>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <h3>Which session was this?</h3>
        <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      <p className="muted small">Week {wk.week} · {wk.label} — tap the planned session this run was.</p>
      <div className="sessions">
        {wk.sessions.map((s, i) => {
          const d = sessionDescription(s, null);
          const on = completion && completion.planned_week === wk.week && completion.planned_day === s.day;
          const sug = !on && i === suggestedIdx;
          return (
            <button key={i} className={`session pick ${on ? "on" : ""} ${sug ? "sug" : ""}`} onClick={() => link(s)} disabled={saving}>
              <div className="session-day">{s.day}</div>
              <div className="session-body"><div className="session-title">{d.title}</div></div>
              {sug && <Pill tone="accent">likely</Pill>}
              {s.quality && <Pill tone="hard">quality</Pill>}
            </button>
          );
        })}
      </div>
      {completion && (
        <button className="btn-ghost wide" onClick={unlink} disabled={saving} style={{ marginTop: 10 }}>Unlink this run</button>
      )}
    </section>
  );
}


function HRZoneBreakdown({ streams, lt1, lt2 }) {
  if (!streams) return null;
  const hr = streams.heartrate && (Array.isArray(streams.heartrate) ? streams.heartrate : streams.heartrate.data);
  const time = streams.time && (Array.isArray(streams.time) ? streams.time : streams.time.data);
  if (!hr || !time || hr.length < 2) return null; // no HR → omit

  if (!lt1 || !lt2) {
    return (
      <section className="card">
        <h3>Time in zones</h3>
        <p className="muted small">Set up your HR zones in Setup to see this run's breakdown.</p>
      </section>
    );
  }

  const Z = [
    { key: "z1", name: "Z1 · Easy",      color: "var(--accent-dim)", test: (b) => b < lt1 },
    { key: "z2", name: "Z2 · Gray zone", color: "var(--amber)",      test: (b) => b >= lt1 && b < lt2 },
    { key: "z3", name: "Z3 · Hard",      color: "var(--coral)",      test: (b) => b >= lt2 },
  ];

  const secs = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < hr.length - 1; i++) {
    const dt = time[i + 1] - time[i];
    if (dt <= 0 || dt > 30) continue; // skip pauses / gaps
    const zi = Z.findIndex((z) => z.test(hr[i]));
    if (zi >= 0) { secs[zi] += dt; total += dt; }
  }
  if (total <= 0) return null;

  const pct = (s) => Math.round((s / total) * 100);

  return (
    <section className="card">
      <div className="card-head"><h3>Time in zones</h3><span className="muted small">LT1 {lt1} · LT2 {lt2}</span></div>
      <div className="zbar">
        {Z.map((z, i) => secs[i] > 0
          ? <div key={z.key} className="zbar-seg" style={{ flex: secs[i], background: z.color }} title={`${z.name}: ${fmtTime(secs[i])}`} />
          : null)}
      </div>
      <div className="zlist">
            {hrZoneBands(lt1, lt2).map((z) => (
              <div key={z.key} className="zitem">
                <div className="zrow">
                  <span className="zdot" style={{ background: z.color }} />
                  <span className="zname">{z.name}</span>
                  <span className="zpct muted">{z.range} bpm</span>
                </div>
                <p className="zone-note muted small">{z.note}</p>
              </div>
            ))}
          </div>
    </section>
  );
}


const LT1_FACTOR = 0.85; // LT1 pre-fill ≈ 85% of LT2; refined later via talk test

function hrZoneBands(lt1, lt2) {
  return [
    { key: "z1", name: "Z1 · Easy",      range: `< ${lt1}`,          color: "var(--accent-dim)", note: "Conversational, fully aerobic. This should be the bulk of your running." },
    { key: "z2", name: "Z2 · Gray zone", range: `${lt1}–${lt2 - 1}`,  color: "var(--amber)",      note: "Too hard to recover from, too easy to drive big gains. Keep time here low." },
    { key: "z3", name: "Z3 · Hard",      range: `${lt2}+`,           color: "var(--coral)",      note: "Threshold and above — your quality sessions and intervals." },
  ];
}

function HRZoneHub({ profile, runs, onSaveHr }) {
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [lt1Draft, setLt1Draft] = useState(profile?.lt1Hr ?? "");

  const lt2 = profile?.lt2Hr ?? null;
  const lt1 = profile?.lt1Hr ?? null;
  const isSetUp = lt2 != null;

  // candidate tests: have HR, ~22–45 min, hardest (highest avg HR) first
  const candidates = (runs || [])
  .filter((r) => r.avgHr && r.timeSec >= 1320 && r.timeSec <= 2700)
  .sort((a, b) => new Date(b.date) - new Date(a.date))   // most recent first
  .slice(0, 5);

  const linkActivity = async (r) => {
    setBusyId(r.id);
    const res = await computeLt2FromActivity(r.id);
    setBusyId(null);
    if (!res) { alert("Couldn't read enough HR data from that run — pick another."); return; }
    const newLt1 = lt1 != null ? lt1 : Math.round(res.lt2 * LT1_FACTOR); // keep a refined LT1 if set
    onSaveHr({ lt2Hr: res.lt2, lt1Hr: newLt1, lt2SourceActivity: r.id, hrTestedAt: new Date().toISOString().slice(0, 10) });
    setLt1Draft(newLt1);
    setPicking(false);
  };

  const saveLt1 = () => {
    const v = parseInt(lt1Draft, 10);
    if (!Number.isFinite(v) || v <= 0 || (lt2 && v >= lt2)) { alert("LT1 should be a number below your LT2."); return; }
    onSaveHr({ lt1Hr: v });
  };

  return (
    <section className="card">
      <h3>Heart-rate zones</h3>

      {!isSetUp && !picking && (
        <>
          <p className="muted small">
            Your zones come from two thresholds. <strong>LT2</strong> (lactate threshold) is read automatically from a <strong>30-minute test</strong> — warm up, then run a hard, steady, even effort for 30 minutes; the app averages your HR over the final 20 minutes. <strong>LT1</strong> (the top of "easy") is the talk-test point where full sentences get hard — we estimate it from LT2 and you refine it later.
          </p>
          <button className="btn-primary" onClick={() => setPicking(true)}>Link a test activity</button>
        </>
      )}

      {picking && (
        <>
          <p className="muted small">Pick your 30-minute test. Showing hard runs of ~25–40 min, highest average HR first.</p>
          {candidates.length === 0 && <p className="muted small">No suitable runs found — you need a synced run of ~25–40 min with HR data.</p>}
          <div className="splits-table">
            {candidates.map((r) => (
              <button key={r.id} className="test-pick" disabled={busyId === r.id} onClick={() => linkActivity(r)}>
                <span>{relDate(r.date)}</span>
                <span className="mono">{r.distance}km</span>
                <span className="mono">{fmtTime(r.timeSec)}</span>
                <span className="mono">{r.avgHr} bpm</span>
                <span className="test-go">{busyId === r.id ? "…" : "use ›"}</span>
              </button>
            ))}
          </div>
          {isSetUp && <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setPicking(false)}>Cancel</button>}
        </>
      )}

      {isSetUp && !picking && (
        <>
          <div className="zlist">
            {hrZoneBands(lt1, lt2).map((z) => (
              <div key={z.key} className="zrow">
                <span className="zdot" style={{ background: z.color }} />
                <span className="zname">{z.name}</span>
                <span className="zpct muted">{z.range} bpm</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            LT2 {lt2} bpm{profile?.hrTestedAt ? ` · tested ${relDate(profile.hrTestedAt)}` : ""}.
          </p>

          <label className="field" style={{ marginTop: 10 }}>
            <span>LT1 (talk-test) <span className="muted">· pre-filled — refine from an easy run</span></span>
            <div className="row-gap">
              <input type="number" value={lt1Draft} onChange={(e) => setLt1Draft(e.target.value)} style={{ maxWidth: 120 }} />
              <button className="btn-ghost" onClick={saveLt1}>Save LT1</button>
            </div>
          </label>
          <p className="muted small">On an easy run, note the HR where talking in full sentences gets hard — enter it here to sharpen the easy/gray-zone line.</p>

          <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>↻ Re-test / relink</button>
        </>
      )}
    </section>
  );
}

// Runs backfill → enrich → streams, looping each past the rate limit until done.
function SyncButton({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const call = (path) => fetch(path).then((r) => r.json());

  const loop = async (path, label, maxRounds = 12) => {
    let last = null;
    for (let i = 0; i < maxRounds; i++) {
      last = await call(path);
      if (!last.ok) throw new Error(last.error || `${label} failed`);
      setStatus(`${label}… ${last.remaining ?? 0} left`);
      if (last.stoppedForRateLimit) return { ...last, rateLimited: true };
      if ((last.remaining ?? 0) === 0) return last;
    }
    return last;
  };

  const sync = async () => {
    setBusy(true);
    try {
      setStatus("Importing activities…");
      const bf = await call("/api/strava/backfill");
      if (!bf.ok) throw new Error(bf.error || "import failed");
      setStatus("Fetching details…");
      const en = await loop("/api/strava/enrich", "Details");
      setStatus("Fetching streams…");
      const st = await loop("/api/strava/streams", "Streams");
      await onDone();
      setStatus(
        en.rateLimited || st.rateLimited
          ? "Strava's 15-min limit reached — synced what I could. Tap Sync again in ~15 min to finish."
          : `Synced — ${bf.upserted} activities up to date.`
      );
    } catch (e) {
      setStatus(`Sync failed: ${e.message}`);
    }
    setBusy(false);
  };

  return (
    <div className="sync">
      {status && <span className="muted small sync-status">{status}</span>}
      <button className="btn-ghost" onClick={sync} disabled={busy}>{busy ? "Syncing…" : "⟳ Sync Strava"}</button>
    </div>
  );
}

function CrossForm({ onAdd }) {
  const [activity, setActivity] = useState("Strength");
  const [minutes, setMinutes] = useState("");
  const [intensity, setIntensity] = useState("moderate");
  return (
    <div className="form-grid">
      <label className="field"><span>Activity</span>
        <select value={activity} onChange={(e) => setActivity(e.target.value)}>
          {["Strength", "Pilates", "Swimming", "Cycling", "Yoga", "Walk / Hike", "Other"].map((a) => <option key={a}>{a}</option>)}
        </select>
      </label>
      <label className="field"><span>Minutes</span>
        <input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label className="field"><span>Intensity</span>
        <select value={intensity} onChange={(e) => setIntensity(e.target.value)}>
          {["easy", "moderate", "hard"].map((a) => <option key={a}>{a}</option>)}
        </select>
      </label>
      <button className="btn-primary span-2" disabled={!minutes}
        onClick={() => onAdd({ id: Date.now(), date: new Date().toISOString().slice(0, 10), activity, minutes, intensity })}>
        Add
      </button>
    </div>
  );
}

/* ---------- FUEL ---------- */

const CARB_HINTS = ["rice", "pasta", "bread", "toast", "oat", "oatmeal", "potato", "banana", "cereal", "noodle", "bagel", "honey", "fruit", "wrap", "tortilla", "muesli", "porridge", "granola", "quinoa", "couscous", "gnocchi", "pancake", "pizza", "crumpet", "apple", "mango", "raisin", "date", "jam", "maple", "chips", "fries", "sushi", "bun", "roll", "cracker", "biscuit", "smoothie", "juice"];
const PROTEIN_HINTS = ["egg", "chicken", "beef", "fish", "salmon", "tofu", "yoghurt", "yogurt", "protein", "beans", "lentil", "cheese", "milk", "tuna", "pork", "lamb", "turkey", "steak", "mince", "prawn", "shrimp", "nuts", "peanut", "almond", "whey", "ham", "sausage", "bacon", "chickpea", "edamame"];

// Whole-word fuel detection. Splits free text into words and adds a light
// singular form ("oats"→"oat", "potatoes"→"potato"), then matches whole tokens
// against the hint list — so "goat cheese" no longer reads as oats, while
// "rice cakes" / "two bananas" still register. Crude but reliable yes/no.
function hasFuelWord(text, hints) {
  const tokens = String(text || "").toLowerCase().match(/[a-z]+/g) || [];
  const set = new Set();
  tokens.forEach((t) => {
    set.add(t);
    if (t.length > 4 && t.endsWith("es")) set.add(t.slice(0, -2));
    else if (t.length > 3 && t.endsWith("s")) set.add(t.slice(0, -1));
  });
  return hints.some((h) => set.has(h));
}

// Did the runner have carbs logged ahead of this run? Looks at the day before
// (any meal) plus the run-day breakfast (covers morning runs). Returns
// true / false / null (nothing logged → unknown). Shared by Insights + Fuel.
function carbsLoggedBeforeRun(r, fuelByDate) {
  const before = fuelByDate[addDays(r.date, -1)];
  const same = fuelByDate[r.date];
  if (!before && !same) return null;
  const beforeText = before ? [before.breakfast, before.lunch, before.dinner, before.snacks].join(" ") : "";
  const amText = same ? same.breakfast || "" : "";
  return hasFuelWord(`${beforeText} ${amText}`, CARB_HINTS);
}

function FuelView({ fuel, onSave, runs }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [breakfast, setBreakfast] = useState("");
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [snacks, setSnacks] = useState("");
  const [water, setWater] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = () => {
    onSave({ id: Date.now(), date, breakfast, lunch, dinner, snacks, water });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setBreakfast(""); setLunch(""); setDinner(""); setSnacks(""); setWater("");
  };

  // Recent long runs (linked long, or any 75min+ effort) + whether carbs were
  // logged ahead of each — the link that feeds the Insights fuelling card.
  const fuelByDate = {};
  fuel.forEach((f) => (fuelByDate[f.date] = f));
  const longRuns = runs.filter((r) => r.type === "long" || r.timeSec >= 75 * 60).slice(0, 6);

  return (
    <div className="stack">
      <section className="card">
        <h3>Log a day's food</h3>
        <p className="muted">Just jot what you ate — no calories, no weighing. For a morning run, the day <em>before</em> matters most for how you'll feel. For an evening run, dinner usually comes <em>after</em>, so leave it blank — what counts that day is your breakfast, lunch and snacks.</p>
        <div className="form-grid">
          <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Water (rough, e.g. 2L)</span><input type="text" value={water} onChange={(e) => setWater(e.target.value)} /></label>
        </div>
        <label className="field"><span>Breakfast</span><input type="text" value={breakfast} onChange={(e) => setBreakfast(e.target.value)} /></label>
        <label className="field"><span>Lunch</span><input type="text" value={lunch} onChange={(e) => setLunch(e.target.value)} /></label>
        <label className="field"><span>Dinner <span className="muted">· skip if it's after your run</span></span><input type="text" value={dinner} onChange={(e) => setDinner(e.target.value)} /></label>
        <label className="field"><span>Snacks</span><input type="text" value={snacks} onChange={(e) => setSnacks(e.target.value)} /></label>
        <button className="btn-primary" onClick={submit} disabled={!breakfast && !lunch && !dinner}>{saved ? "✓ Saved" : "Save day"}</button>
      </section>

      <section className="card">
        <h3>Fuel log</h3>
        {fuel.length === 0 && <p className="muted">Nothing logged yet.</p>}
        {fuel.map((f) => {
          const text = [f.breakfast, f.lunch, f.dinner, f.snacks].join(" ");
          const hasCarb = hasFuelWord(text, CARB_HINTS);
          const hasProtein = hasFuelWord(text, PROTEIN_HINTS);
          return (
            <div key={f.id} className="row-item col">
              <div className="fuel-head">
                <strong>{relDate(f.date)}</strong>
                <div className="row-gap">
                  <Pill tone={hasCarb ? "accent" : "warn"}>{hasCarb ? "carbs ✓" : "low carbs?"}</Pill>
                  <Pill tone={hasProtein ? "accent" : "warn"}>{hasProtein ? "protein ✓" : "low protein?"}</Pill>
                </div>
              </div>
              {f.breakfast && <div className="meal"><span>B</span>{f.breakfast}</div>}
              {f.lunch && <div className="meal"><span>L</span>{f.lunch}</div>}
              {f.dinner && <div className="meal"><span>D</span>{f.dinner}</div>}
              {f.snacks && <div className="meal"><span>S</span>{f.snacks}</div>}
              {f.water && <div className="meal"><span>💧</span>{f.water}</div>}
            </div>
          );
        })}
      </section>

      {longRuns.length > 0 && (
        <section className="card">
          <h3>Before your long runs</h3>
          <p className="muted small">Whether you had carbs logged the day before (or breakfast on the day). This feeds the fuelling insight.</p>
          {longRuns.map((r) => {
            const c = carbsLoggedBeforeRun(r, fuelByDate);
            return (
              <div key={r.id} className="row-item">
                <span>{relDate(r.date)} · {r.distance}km</span>
                <Pill tone={c === true ? "accent" : c === false ? "warn" : "base"}>
                  {c === true ? "carbs ✓" : c === false ? "low carbs?" : "not logged"}
                </Pill>
              </div>
            );
          })}
        </section>
      )}

      <section className="card note-card">
        <p className="muted small">
          This is a simple fuelling check for energy and recovery, not a diet tool. The general
          idea: carbs are your running fuel (especially before longer or harder sessions), protein
          supports recovery, and hydration matters. If you want a real nutrition plan, a sports
          dietitian beats any app.
        </p>
      </section>
    </div>
  );
}

/* ---------- INSIGHTS ---------- */

// Classify a run's overall intensity for the easy/hard balance. Prefer HR vs
// LT1 (your aerobic ceiling); fall back to pace vs the easy zone when HR is
// missing. Returns "easy" | "hard" | null (can't tell). Avoids the stored
// `type`, which defaults to "easy" on unlinked synced runs.
function runIntensity(r, zones, lt1) {
  if (r.avgHr && lt1) return r.avgHr <= lt1 ? "easy" : "hard";
  const p = paceOf(r);
  if (p && zones && zones.easy) return p >= zones.easy[1] ? "easy" : "hard";
  return null;
}

// km totalled into rolling 7-day buckets, oldest → newest. Last entry is the
// current (partial) week.
function weeklyVolumeSeries(runs, n) {
  const now = Date.now(), DAY = 864e5;
  const weeks = Array.from({ length: n }, () => 0);
  runs.forEach((r) => {
    const age = (now - new Date(r.date).getTime()) / DAY;
    if (age < 0 || age >= n * 7) return;
    weeks[Math.floor(age / 7)] += parseFloat(r.distance) || 0;
  });
  return weeks.reverse();
}

function Insights({ runs, fuel, zones, profile }) {
  if (runs.length < 3) return <Empty msg="Sync or log a few runs and the patterns will show up here." />;

  const lt1 = profile?.lt1Hr ?? null;
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
  const ageDays = (d) => (Date.now() - new Date(d).getTime()) / 864e5;

  // ---- objective: synced data ----
  const vol = weeklyVolumeSeries(runs, 8);
  const volMax = Math.max(1, ...vol);
  const load = loadWatch(runs);

  // easy/hard balance over the last 28 days, by moving time
  const recent = runs.filter((r) => ageDays(r.date) < 28);
  let easySec = 0, hardSec = 0, classified = 0;
  recent.forEach((r) => {
    const cls = runIntensity(r, zones, lt1);
    if (!cls) return;
    classified += 1;
    if (cls === "easy") easySec += r.timeSec || 0; else hardSec += r.timeSec || 0;
  });
  const balTotal = easySec + hardSec;
  const easyPct = balTotal ? Math.round((easySec / balTotal) * 100) : null;

  // aerobic fitness: avg easy-pace this 28d vs the 28d before (easy-classified)
  const easyWindow = (lo, hi) => {
    const rs = runs.filter((r) => {
      const a = ageDays(r.date);
      return a >= lo && a < hi && runIntensity(r, zones, lt1) === "easy" && paceOf(r) > 0;
    });
    const hrs = rs.filter((r) => r.avgHr).map((r) => r.avgHr);
    return {
      n: rs.length,
      pace: rs.length ? rs.reduce((a, r) => a + paceOf(r), 0) / rs.length : null,
      hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    };
  };
  const fitNow = easyWindow(0, 28), fitPrev = easyWindow(28, 56);
  const fitnessReady = fitNow.n >= 3 && fitPrev.n >= 3 && fitNow.pace && fitPrev.pace;
  const fitnessDelta = fitnessReady ? fitPrev.pace - fitNow.pace : 0; // +ve = faster now

  // consistency: runs in last 28d + current run-every-week streak
  const runs28 = recent.length;
  let streak = 0;
  for (let w = 0; w < 26; w++) {
    const c = runs.filter((r) => { const a = ageDays(r.date); return a >= w * 7 && a < (w + 1) * 7; }).length;
    if (c > 0) streak += 1; else break;
  }

  // easy-but-hot: ran at easy pace yet HR drifted over LT1 (heat/fatigue).
  // Pace-based intent + HR-based flag — no reliance on the stored type.
  const easyPaced = (lt1 && zones && zones.easy) ? runs.filter((r) => r.avgHr && paceOf(r) >= zones.easy[1]) : [];
  const hotEasy = easyPaced.filter((r) => r.avgHr > lt1);

  // ---- self-report: how runs felt ----
  const scored = runs.filter((r) => r.score != null);
  const lowRuns = scored.filter((r) => r.score <= 6);
  const warmedScores = scored.filter((r) => r.warmup).map((r) => r.score);
  const coldScores = scored.filter((r) => !r.warmup).map((r) => r.score);

  const wrongTally = {};
  lowRuns.forEach((r) => (r.wrong || []).forEach((w) => (wrongTally[w] = (wrongTally[w] || 0) + 1)));
  const topWrong = Object.entries(wrongTally).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const painTally = {};
  runs.forEach((r) => (r.pain || []).forEach((p) => (painTally[p] = (painTally[p] || 0) + 1)));
  const topPain = Object.entries(painTally).sort((a, b) => b[1] - a[1]);

  const showWarm = avg(warmedScores) && avg(coldScores);
  const showHot = lt1 && easyPaced.length >= 3 && hotEasy.length > 0;
  const feelAny = showWarm || topWrong.length > 0 || showHot || topPain.length > 0;

  // ---- fuel link ----
  const fuelByDate = {};
  fuel.forEach((f) => (fuelByDate[f.date] = f));
  const longScored = runs.filter((r) => r.score != null && (r.type === "long" || r.timeSec >= 75 * 60));
  const fueledLong = [], unfueledLong = [];
  longScored.forEach((r) => {
    const c = carbsLoggedBeforeRun(r, fuelByDate);
    if (c === true) fueledLong.push(r); else if (c === false) unfueledLong.push(r);
  });
  const showFuel = fueledLong.length >= 2 && unfueledLong.length >= 1;
  const fueledAvg = avg(fueledLong.map((r) => r.score));
  const unfueledAvg = avg(unfueledLong.map((r) => r.score));

  return (
    <div className="stack">
      <section className="card">
        <h3>What your data is telling you</h3>
        <div className="hero-row">
          <Stat label="Runs (28d)" value={runs28} />
          <Stat label="Avg score" value={avg(scored.map((r) => r.score)) || "—"} accent />
          <Stat label="Week streak" value={streak} />
        </div>
      </section>

      <div className="sub-h">The data</div>

      <section className="card insight">
        <h3>Volume trend</h3>
        <div className="vol-chart">
          {vol.map((km, i) => (
            <div key={i} className="vol-col" title={`${km.toFixed(1)}km`}>
              <div className="vol-bar" style={{ height: `${Math.max(2, Math.round((km / volMax) * 100))}%`, ...(i === vol.length - 1 ? { opacity: 0.45 } : {}) }} />
            </div>
          ))}
        </div>
        <div className="vol-axis muted small"><span>8 weeks ago</span><span>this week</span></div>
        {load.flagged
          ? <p className="muted small">Last full week was {Math.round(load.jump * 100)}% up on the week before — past the ~10% mark that tends to precede injury. Worth an easier week before pushing further.</p>
          : <p className="muted small">Each bar is a week's distance; the last is the current week so far.</p>}
      </section>

      {easyPct != null && classified >= 4 && (
        <section className="card insight">
          <h3>Easy / hard balance</h3>
          <div className="zbar">
            <div className="zbar-seg" style={{ width: `${easyPct}%`, background: "var(--positive)" }} />
            <div className="zbar-seg" style={{ width: `${100 - easyPct}%`, background: "var(--coral)" }} />
          </div>
          <p>
            Last 4 weeks: <strong style={{ color: "var(--positive)" }}>{easyPct}% easy</strong> / {100 - easyPct}% hard {lt1 ? "(by heart rate)" : "(by pace)"}.
            {easyPct >= 75
              ? " Close to the 80/20 sweet spot — mostly easy, a controlled dose of hard. Keep it there."
              : " That's more hard running than the 80/20 ideal. Easing your easy days down protects the quality of your hard ones."}
          </p>
        </section>
      )}

      {fitnessReady && (
        <section className="card insight">
          <h3>Aerobic fitness</h3>
          <p>
            Your easy-run pace over the last 4 weeks averaged <strong className="mono">{fmtPace(fitNow.pace)}</strong>{fitNow.hr ? ` at ~${fitNow.hr} bpm` : ""}, vs <strong className="mono">{fmtPace(fitPrev.pace)}</strong> the 4 weeks before.
            {Math.abs(fitnessDelta) < 3
              ? " Holding steady."
              : fitnessDelta > 0
                ? " You're running easy faster for the same effort — aerobic fitness is trending up."
                : " Easy pace has slipped a little — could be fatigue, heat, or a heavier block."}
          </p>
        </section>
      )}

      {feelAny && <div className="sub-h">How your runs felt</div>}

      {showWarm && (
        <section className="card insight">
          <h3>Warm-up effect</h3>
          <p>
            Runs where you warmed up score <strong style={{ color: "var(--positive)" }}>{avg(warmedScores)}/10</strong> on
            average, vs <strong style={{ color: "var(--coral)" }}>{avg(coldScores)}/10</strong> when you didn't.
            {Number(avg(warmedScores)) > Number(avg(coldScores)) + 0.5
              ? " That gap is your 4–5km problem in numbers — warming up first is the cheapest win you have."
              : " Keep logging — the picture will sharpen."}
          </p>
        </section>
      )}

      {topWrong.length > 0 && (
        <section className="card insight">
          <h3>Your tougher runs usually involve</h3>
          <div className="bars">
            {topWrong.map(([w, n]) => (
              <div key={w} className="bar-row">
                <span className="bar-label">{w}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / lowRuns.length) * 100}%` }} /></div>
                <span className="bar-n">{n}</span>
              </div>
            ))}
          </div>
          {wrongTally["Started too fast"] >= 2 && (
            <p className="muted small">"Started too fast" keeps showing up — try forcing your first 2km to feel almost too slow. It's the fix for both the warm-up grind and the breathing spikes.</p>
          )}
        </section>
      )}

      {showHot && (
        <section className="card insight">
          <h3>Easy days running hot</h3>
          <p>
            {hotEasy.length} of your {easyPaced.length} easy-paced runs with HR data averaged above
            your LT1 of {lt1} bpm — the pace looked easy but the effort wasn't. Heat, hills and
            fatigue all push HR up. On easy days, back off enough to keep your average under {lt1}.
          </p>
        </section>
      )}

      {topPain.length > 0 && (
        <section className="card insight">
          <h3>🩹 Pain map</h3>
          {topPain.map(([p, n]) => (
            <div key={p} className="row-item"><span>{p}</span><Pill tone={n >= 3 ? "warn" : "base"}>{n}×</Pill></div>
          ))}
          {topPain[0][1] >= 3 && <p className="muted small">{topPain[0][0]} has come up {topPain[0][1]} times — worth getting a physio to look at it before it becomes a layoff.</p>}
        </section>
      )}

      {showFuel && (
        <>
          <div className="sub-h">Fuelling</div>
          <section className="card insight">
            <h3>Fuelling &amp; long runs</h3>
            <p>
              Your long runs with carbs logged the day before score <strong style={{ color: "var(--positive)" }}>{fueledAvg}/10</strong> on
              average, vs <strong style={{ color: "var(--coral)" }}>{unfueledAvg}/10</strong> when you hadn't.
              {Number(fueledAvg) > Number(unfueledAvg) + 0.5
                ? " Carbing up the day before clearly pays off — make it routine before long runs."
                : " Keep logging your food to sharpen the picture."}
            </p>
          </section>
        </>
      )}

      <MusicInsights />
    </div>
  );
}

// Average HR / pace of the chart points falling inside a song's time window.
function streamAvgWindow(series, startSec, endSec) {
  const pts = series.points.filter((p) => p.t >= startSec && p.t <= endSec);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    hr: mean(pts.filter((p) => p.hr != null).map((p) => p.hr)),
    pace: mean(pts.filter((p) => p.pace != null).map((p) => p.pace)),
  };
}

// Aggregate listening stats + per-moment HR/pace per track from raw history.
function computeMusicInsights(hist) {
  if (!hist || !hist.plays || !hist.plays.length) return null;
  const { plays, dateById = {}, streamsById = {} } = hist;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  const trackMap = {};
  plays.forEach((p) => {
    const key = p.track_id || p.track_name;
    if (!trackMap[key]) trackMap[key] = { key, name: p.track_name, artists: Array.isArray(p.artists) ? p.artists : [], art: p.album_art_url, uri: p.track_uri, count: 0, hrs: [], paces: [] };
    trackMap[key].count += 1;
  });
  const artistMap = {};
  plays.forEach((p) => (Array.isArray(p.artists) ? p.artists : []).forEach((a) => (artistMap[a] = (artistMap[a] || 0) + 1)));

  // per-moment: only for activities we have cached streams for
  const seriesByAct = {};
  Object.keys(streamsById).forEach((id) => { const s = buildSeries(streamsById[id]); if (s) seriesByAct[id] = s; });
  plays.forEach((p) => {
    const series = seriesByAct[p.activity_id];
    const date = dateById[p.activity_id];
    if (!series || !date) return;
    const startMs = new Date(date).getTime();
    const endSec = (new Date(p.played_at).getTime() - startMs) / 1000;
    const w = streamAvgWindow(series, Math.max(0, endSec - (p.duration_ms || 0) / 1000), endSec);
    const t = trackMap[p.track_id || p.track_name];
    if (w.hr != null) t.hrs.push(w.hr);
    if (w.pace != null) t.paces.push(w.pace);
  });

  const tracks = Object.values(trackMap).map((t) => ({ ...t, avgHr: mean(t.hrs), avgPace: mean(t.paces) }));
  return {
    total: plays.length,
    unique: tracks.length,
    runsWithMusic: new Set(plays.map((p) => p.activity_id)).size,
    leaderboard: tracks.slice().sort((a, b) => b.count - a.count).slice(0, 6),
    topArtist: Object.entries(artistMap).sort((a, b) => b[1] - a[1])[0] || null,
    hardest: tracks.filter((t) => t.avgHr != null).sort((a, b) => b.avgHr - a.avgHr).slice(0, 5),
    fastest: tracks.filter((t) => t.avgPace != null).sort((a, b) => a.avgPace - b.avgPace).slice(0, 5),
  };
}

// Loads its own history on mount so it doesn't block the rest of Insights;
// renders nothing until there's music to show.
function MusicInsights() {
  const [insight, setInsight] = useState(null);
  useEffect(() => {
    let alive = true;
    loadSpotifyHistory().then((d) => { if (alive) setInsight(d ? computeMusicInsights(d) : null); });
    return () => { alive = false; };
  }, []);
  if (!insight || insight.total === 0) return null;

  const { total, unique, runsWithMusic, leaderboard, topArtist, hardest, fastest } = insight;
  const perRun = runsWithMusic ? (total / runsWithMusic).toFixed(1) : "—";

  return (
    <>
      <div className="sub-h">Your soundtrack</div>

      <section className="card">
        <h3>Listening</h3>
        <div className="hero-row">
          <Stat label="Tracks played" value={total} />
          <Stat label="Unique" value={unique} accent />
          <Stat label="Per run" value={perRun} />
        </div>
        {topArtist && <p className="muted small">Most-played artist: <strong>{topArtist[0]}</strong> ({topArtist[1]} {topArtist[1] === 1 ? "play" : "plays"}).</p>}
      </section>

      {leaderboard.length > 0 && (
        <section className="card insight">
          <h3>Your running soundtrack</h3>
          <div className="song-list">
            {leaderboard.map((t) => (
              <div key={t.key} className="song-rank">
                <SongCell seg={t} />
                <Pill tone="base">{t.count}×</Pill>
              </div>
            ))}
          </div>
        </section>
      )}

      {hardest.length > 0 && (
        <section className="card insight">
          <h3>Songs you run hardest to</h3>
          <p className="muted small">Average heart rate while each track played.</p>
          <div className="song-list">
            {hardest.map((t) => (
              <div key={t.key} className="song-rank">
                <SongCell seg={t} />
                <span className="song-stat" style={{ color: "var(--viz-b)" }}>{Math.round(t.avgHr)} bpm</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {fastest.length > 0 && (
        <section className="card insight">
          <h3>Songs you run fastest to</h3>
          <p className="muted small">Average pace while each track played.</p>
          <div className="song-list">
            {fastest.map((t) => (
              <div key={t.key} className="song-rank">
                <SongCell seg={t} />
                <span className="song-stat mono" style={{ color: "var(--accent)" }}>{fmtPace(t.avgPace)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ---------- SETUP ---------- */

// Weekday chips render Mon-first (calendar habit); plan internals use DOW (Sun-first).
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// A spread-out default set of N run days (reuses the legacy long/quality/easy
// ordering, then sorts to weekday order for display).
function defaultPreferred(n) {
  const legacy = ["Sun", "Tue", "Thu", "Mon", "Wed", "Fri", "Sat"].slice(0, n);
  return DAY_ORDER.filter((d) => legacy.includes(d));
}
function defaultLong(days) {
  return days.includes("Sun") ? "Sun" : days.includes("Sat") ? "Sat" : days[days.length - 1] || "";
}

function Setup({ profile, onSave, zones, runs, onPlanReset }) {
  const [name, setName] = useState(profile?.name || "");
  const [goalType, setGoalType] = useState(profile?.goalType || "distance");
  const [goalDistanceKm, setGoalDistanceKm] = useState(profile?.goalDistanceKm || 21.1);
  const [goalTime, setGoalTime] = useState(profile?.goalTime || "");
  const [goalDate, setGoalDate] = useState(profile?.goalDate || "");  
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState(profile?.currentWeeklyKm || 25);
  const initDays = profile?.daysPerWeek || 4;
  const initPref = profile?.preferredDays && profile.preferredDays.length === initDays
    ? DAY_ORDER.filter((d) => profile.preferredDays.includes(d))
    : defaultPreferred(initDays);
  const [daysPerWeek, setDaysPerWeek] = useState(initDays);
  const [planStartDate, setPlanStartDate] = useState(profile?.planStartDate || todayISO());
  const [preferredDays, setPreferredDays] = useState(initPref);
  const [longDay, setLongDay] = useState(profile?.longDay && initPref.includes(profile.longDay) ? profile.longDay : defaultLong(initPref));
  const [benchDist, setBenchDist] = useState(profile?.benchDistKm || 5);
  const [benchTime, setBenchTime] = useState(profile?.benchTimeSec ? fmtTime(profile.benchTimeSec) : "");
  const [easyPace, setEasyPace] = useState(profile?.easyPaceSec ? fmtTime(profile.easyPaceSec) : "");
  const [saved, setSaved] = useState(false);
  const [goalMode, setGoalMode] = useState(profile?.goalMode || "race");

  // Number of run days drives the day picker — reseed to a sensible spread.
  const changeDays = (v) => {
    const n = parseInt(v);
    setDaysPerWeek(n);
    const pref = defaultPreferred(n);
    setPreferredDays(pref);
    setLongDay(defaultLong(pref));
  };
  const toggleDay = (d) => {
    const next = preferredDays.includes(d)
      ? preferredDays.filter((x) => x !== d)
      : DAY_ORDER.filter((x) => preferredDays.includes(x) || x === d);
    setPreferredDays(next);
    if (!next.includes(longDay)) setLongDay(defaultLong(next));
  };
  const daysValid = preferredDays.length === parseInt(daysPerWeek) && !!longDay;

  const submit = () => {
    const goalLabel =
      goalType === "time" && goalTime
        ? `${goalDistanceKm}km in ${goalTime}`
        : `${goalDistanceKm}km`;
    // Reschedules/skips are tweaks on top of a specific generated plan. If a
    // schedule-structural field changes, those overrides no longer line up, so
    // drop them; pace/name/bench edits leave them intact.
    const scheduleChanged =
      planStartDate !== (profile?.planStartDate || "") ||
      goalDate !== (profile?.goalDate || "") ||
      parseInt(daysPerWeek) !== (profile?.daysPerWeek ?? null) ||
      longDay !== (profile?.longDay || "") ||
      JSON.stringify(preferredDays) !== JSON.stringify(profile?.preferredDays || []);
    onSave({
      name,
      goalType,
      goalMode,
      goalDistanceKm: parseFloat(goalDistanceKm),
      goalTime,
      goalLabel,
      goalDate,
      currentWeeklyKm: parseFloat(currentWeeklyKm),
      daysPerWeek: parseInt(daysPerWeek),
      planStartDate,
      preferredDays,
      longDay,
      scheduleOverrides: scheduleChanged ? {} : (profile?.scheduleOverrides || {}),
      benchDistKm: parseFloat(benchDist),
      benchTimeSec: parseTime(benchTime),
      easyPaceSec: easyPace && parseTime(easyPace) > 0 ? parseTime(easyPace) : null,
      lt1Hr: profile?.lt1Hr ?? null,
      lt2Hr: profile?.lt2Hr ?? null,
      lt2SourceActivity: profile?.lt2SourceActivity ?? null,
      hrTestedAt: profile?.hrTestedAt ?? null,
    });
    // A new/changed plan invalidates the old plan→run linkages; wipe them so
    // stale "done" ticks don't carry over onto the regenerated schedule.
    if (scheduleChanged && onPlanReset) onPlanReset();
    setSaved(true); setTimeout(() => setSaved(false), 2200);
  };

  const PRESET = [["5K", 5], ["10K", 10], ["Half", 21.1], ["Marathon", 42.2]];

  return (
    <div className="stack">
      <section className="card">
        <h3>Your profile</h3>
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chris" /></label>
      </section>
      <section className="card">
        <div className="card-head">
          <h3>Spotify</h3>
          <Pill tone="base">optional</Pill>
        </div>
        <p className="muted small" style={{ margin: "0 0 12px" }}>
          Link your account and STRIDE records what was playing during each run, so you can see the
          setlist on the activity afterwards.
        </p>
        <a className="btn-ghost wide btn-link" href="/api/spotify/authorize">Connect Spotify ↗</a>
      </section>
      <section className="card">
        <h3>Your goal</h3>
        <div className="chips">
          {PRESET.map(([l, km]) => (
            <button key={l} className={`chip ${parseFloat(goalDistanceKm) === km ? "chip-on" : ""}`} onClick={() => setGoalDistanceKm(km)}>{l}</button>
          ))}
        </div>
        <div className="form-grid">
          <label className="field"><span>Distance (km)</span><input type="number" step="0.1" value={goalDistanceKm} onChange={(e) => setGoalDistanceKm(e.target.value)} /></label>
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip ${goalMode === "race" ? "chip-on" : ""}`} onClick={() => setGoalMode("race")}>Training for a race</button>
          <button className={`chip ${goalMode === "fitness" ? "chip-on" : ""}`} onClick={() => setGoalMode("fitness")}>General fitness</button>
        </div>
          <label className="field"><span>Goal type</span>
            <select value={goalType} onChange={(e) => setGoalType(e.target.value)}>
              <option value="distance">Just finish the distance</option>
              <option value="time">Target time</option>
            </select>
          </label>
          {goalType === "time" && (
            <label className="field"><span>Target time (h:mm:ss)</span><input value={goalTime} onChange={(e) => setGoalTime(e.target.value)} placeholder="1:45:00" /></label>
          )}
          <label className="field"><span>Goal date</span><input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h3>Your current training</h3>
        <div className="form-grid">
          <label className="field"><span>Current weekly km</span><input type="number" value={currentWeeklyKm} onChange={(e) => setCurrentWeeklyKm(e.target.value)} /></label>
          <label className="field"><span>Days/week you'll run</span>
            <select value={daysPerWeek} onChange={(e) => changeDays(e.target.value)}>
              {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="field"><span>Plan start date</span><input type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} /></label>
        </div>
        {parseInt(daysPerWeek) === 2 && (
          <p className="muted small">On 2 days a week, both runs count: one long run (easy effort) and one quality session. That's a legit way to train — consistency beats volume.</p>
        )}

        <label className="field" style={{ marginTop: 4 }}>
          <span>Which days do you run? <span className="muted">· pick {parseInt(daysPerWeek)}</span></span>
        </label>
        <div className="chips">
          {DAY_ORDER.map((d) => (
            <button key={d} type="button" className={`chip ${preferredDays.includes(d) ? "chip-on" : ""}`} onClick={() => toggleDay(d)}>{d}</button>
          ))}
        </div>
        {!daysValid && (
          <p className="warn small" style={{ marginTop: 8 }}>
            Pick exactly {parseInt(daysPerWeek)} day{parseInt(daysPerWeek) === 1 ? "" : "s"} ({preferredDays.length} selected).
          </p>
        )}

        {preferredDays.length > 0 && (
          <>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Long run day</span>
            </label>
            <div className="chips">
              {DAY_ORDER.filter((d) => preferredDays.includes(d)).map((d) => (
                <button key={d} type="button" className={`chip ${longDay === d ? "chip-on" : ""}`} onClick={() => setLongDay(d)}>{d}</button>
              ))}
            </div>
          </>
        )}
      </section>
      
      <PushToggle />

      <section className="card">
        <h3>Your current fitness <span className="muted">(sets your paces)</span></h3>
        <p className="muted small">
          Use your most recent <strong>representative</strong> hard effort — a recent 5K, 10K or parkrun
          beats an old or off-day race. Your paces are calculated from this. They don't drift on their
          own, so when you get fitter, re-test (a parkrun or a 2km time trial) and update here — or just
          tap "Update my paces" when the app spots a fast run. Everything recalculates instantly.
        </p>
        <div className="form-grid">
          <label className="field"><span>Distance (km)</span><input type="number" step="0.1" value={benchDist} onChange={(e) => setBenchDist(e.target.value)} /></label>
          <label className="field"><span>Time (h:mm:ss)</span><input value={benchTime} onChange={(e) => setBenchTime(e.target.value)} placeholder="e.g. 25:00 for 5km" /></label>
        </div>

        <label className="field" style={{ marginTop: 4 }}>
          <span>Your real easy / conversational pace <span className="muted">· optional but recommended</span></span>
          <input value={easyPace} onChange={(e) => setEasyPace(e.target.value)} placeholder="e.g. 7:00 per km" />
        </label>
        <p className="muted small">
          This is the fix for the Runna problem. If you know what truly conversational feels like
          (you said ~7:00/km), put it here and the app anchors your easy and long runs to <em>that</em>,
          instead of guessing a pace that's too fast. Easy should feel almost too slow.
        </p>

        {(benchTime && parseTime(benchTime) > 0) || (easyPace && parseTime(easyPace) > 0) ? (
          <PaceTable
            bench={benchTime && parseTime(benchTime) > 0 ? [parseFloat(benchDist), parseTime(benchTime)] : null}
            easySec={easyPace && parseTime(easyPace) > 0 ? parseTime(easyPace) : null}
          />
        ) : null}
      </section>

      <HRZoneHub profile={profile} runs={runs} onSaveHr={(fields) => onSave({ ...profile, ...fields })} />
      <button className="btn-primary" onClick={submit} disabled={!daysValid || ((!benchTime || parseTime(benchTime) <= 0) && (!easyPace || parseTime(easyPace) <= 0))}>{saved ? "✓ Saved — check the Plan tab" : "Save & generate plan"}</button>

      <section className="card">
        <h3>Account</h3>
        <SignOutButton className="btn-ghost wide" />
      </section>
    </div>
  );
}

function PaceTable({ bench, easySec }) {
  const profileLike = {
    benchDistKm: bench ? bench[0] : null,
    benchTimeSec: bench ? bench[1] : null,
    easyPaceSec: easySec || null,
  };
  const z = computeZones(profileLike);
  if (!z) return null;
  const preds = bench
    ? [
        ["5K", riegel(bench[1], bench[0], 5)],
        ["10K", riegel(bench[1], bench[0], 10)],
        ["Half", riegel(bench[1], bench[0], 21.1)],
        ["Marathon", riegel(bench[1], bench[0], 42.2)],
      ]
    : [];
  return (
    <div className="pace-table">
      <div className="pt-section">Your training paces</div>
      {Object.entries(z).map(([k, v]) =>
        v ? (
          <div key={k} className="pt-row">
            <span className="pt-zone">{ZONE_META[k].name}</span>
            <span className="pt-pace">{fmtPace(v[0])}–{fmtPace(v[1])}</span>
          </div>
        ) : null
      )}
      {preds.length > 0 && <div className="pt-section">Predicted race times (current fitness)</div>}
      {preds.map(([l, t]) => (
        <div key={l} className="pt-row"><span className="pt-zone">{l}</span><span className="pt-pace">{fmtTime(t)}</span></div>
      ))}
    </div>
  );
}

/* ---------- shared small bits ---------- */

function Empty({ msg }) {
  return <div className="card empty">{msg}</div>;
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function paceOf(r) { return r.timeSec && r.distance ? r.timeSec / parseFloat(r.distance) : 0; }
function scoreColor(s) { return s >= 8 ? "var(--positive)" : s >= 5 ? "var(--amber)" : "var(--coral)"; }

// Find the plan week whose 7-day block [weekStart, weekStart+7) contains `iso`,
// clamping to the first/last week outside the plan's span. weekStart is stamped
// on every week by buildWeek, so this stays consistent with the displayed dates.
function weekForDate(plan, iso) {
  if (!plan.length || !iso) return null;
  for (const w of plan) {
    if (w.weekStart && iso >= w.weekStart && iso < addDays(w.weekStart, 7)) return w;
  }
  // before the plan starts -> week 1; after it ends -> last week
  if (plan[0].weekStart && iso < plan[0].weekStart) return plan[0];
  return plan[plan.length - 1];
}

function currentWeek(profile, plan) {
  if (!plan.length) return null;
  return weekForDate(plan, todayISO()) || plan[0];
}

// Map a run's date to its plan week (used when linking a logged run to a slot).
function planWeekForDate(plan, dateIso) {
  if (!plan.length || !dateIso) return null;
  return weekForDate(plan, isoDate(dateIso));
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Best-guess which planned session a run was: weekday first, distance second.
// Returns an index into sessions, or -1 if nothing scores.
function suggestSessionIdx(sessions, activity) {
  if (!sessions || !sessions.length) return -1;
  const runDay = activity.date ? DOW[new Date(activity.date).getDay()] : null;
  const dist = activity.distance_km != null ? Number(activity.distance_km) : null;
  let bestIdx = -1, best = 0;
  sessions.forEach((s, i) => {
    let score = 0;
    if (runDay && s.day === runDay) score += 100;            // same weekday: strongest signal
    if (dist != null && s.km) {                              // distance fit (long/easy carry km)
      score += Math.max(0, 40 * (1 - Math.abs(dist - s.km) / s.km));
      if (s.type === "long" && dist >= s.km * 0.85) score += 25;  // a long effort leans long
    }
    if (score > best) { best = score; bestIdx = i; }
  });
  return bestIdx;
}

// Which overdue session was a stray run most likely to have been? Nearest
// planned day wins and distance breaks the tie for sessions that carry one
// (quality sessions don't, so they lean entirely on the date). Capped at 3 days
// apart — a Monday run isn't Friday's long run. Returns null when nothing fits.
// suggestSessionIdx does the opposite job (a run picking from a whole week) and
// leans on the weekday matching exactly, which an overdue run never does.
function matchOverdueRun(overdue, run) {
  const rd = isoDate(run.date);
  const dist = parseFloat(run.distance) || null;
  let best = null;
  let bestScore = 0;
  overdue.forEach((s) => {
    const gap = Math.abs(Math.round((new Date(`${rd}T12:00:00`) - new Date(`${s.date}T12:00:00`)) / DAY_MS));
    if (gap > 3) return;
    let score = 40 - gap * 10;
    if (dist != null && s.km) score += Math.max(0, 25 * (1 - Math.abs(dist - s.km) / s.km));
    if (score > bestScore) { bestScore = score; best = s; }
  });
  return best;
}

function daysUntil(iso) {
  const d = Math.ceil((new Date(iso) - new Date()) / (24 * 3600 * 1000));
  return Math.max(0, d);
}
function withinDays(iso, n) {
  return (new Date() - new Date(iso)) / (24 * 3600 * 1000) <= n;
}

function relDate(iso) {
  const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(iso).setHours(0,0,0,0)) / (24 * 3600 * 1000));
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const dt = new Date(iso);
  const opts = { month: "short", day: "numeric" };
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return dt.toLocaleDateString(undefined, opts);
}
/* ---------- styles ---------- */

function StyleBlock() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      .wrap {
        /* Court — energetic light. White ground, electric cobalt action
           colour, tinted card fills, real depth. Cobalt = action/brand;
           the semantic triad is --positive / --amber / --coral; --viz-b is
           the second chart series (HR). Triad values run darker than the
           fills so 11px text clears WCAG AA on white. */
        --bg: #f6f7fb; --panel: #ffffff; --panel-2:#eef1fb; --line:#e3e7f2;
        --ink:#15192b; --muted:#697086; --accent:#2451ff; --accent-dim:#1c40cc;
        --coral:#dc2626; --amber:#b45309; --on-accent:#ffffff;
        --positive:#15803d; --viz-b:#ff7d2e;
        /* Plainhand: one family everywhere; numeral classes keep their
           --font-mono hook but it resolves to the body face, and alignment
           comes from tabular figures below. */
        --font-display: var(--font-body);
        --font-mono: var(--font-body);
        font-family:var(--font-body), sans-serif;
        background: var(--bg);
        background-image: radial-gradient(900px 480px at 80% -15%, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 60%);
        background-repeat: no-repeat;
        color:var(--ink); min-height:100vh; min-height:100dvh; padding:0 0 calc(78px + env(safe-area-inset-bottom)); max-width:760px; margin:0 auto;
      }
      .mono, .stat-val, .pt-pace, .score-big, .run-meta { font-family:var(--font-mono), monospace; }
      .mono, .stat-val, .pt-pace, .score-big, .run-meta, .session-day, .sess-mark,
      .wu-time, .meal span, .bar-n, .nav-date, .srow { font-variant-numeric:tabular-nums; }
      .loading { padding:80px 24px; text-align:center; color:var(--muted); font-size:18px; }

      .topbar { display:flex; align-items:center; justify-content:space-between; padding:calc(22px + env(safe-area-inset-top)) 22px 8px; }
      .brand { font-weight:800; font-size:26px; letter-spacing:-0.04em; display:flex; align-items:center; gap:9px; }
      .logo { height:34px; width:34px; flex-shrink:0; }
      .brand-word { line-height:1; }
      .brand-dot { color:var(--accent); }
      .brand-sub { font-weight:400; font-size:12px; color:var(--muted); margin-left:2px; letter-spacing:0.04em; text-transform:uppercase; align-self:flex-end; padding-bottom:3px; }
      .hello { color:var(--muted); font-size:14px; }
      .top-right { display:flex; align-items:center; gap:10px; }
      .avatar-btn { width:34px; height:34px; border-radius:50%; background:var(--panel); border:1px solid var(--line);
        color:var(--ink); font-family:inherit; font-size:14px; font-weight:700; display:inline-flex; align-items:center;
        justify-content:center; cursor:pointer; flex-shrink:0; transition:.15s; }
      .avatar-btn:hover { border-color:var(--accent-dim); }

      .bottom-nav { position:fixed; left:50%; bottom:0; transform:translateX(-50%); width:100%; max-width:760px; z-index:20;
        display:flex; align-items:stretch; background:color-mix(in srgb, var(--panel) 92%, transparent); backdrop-filter:blur(10px);
        border-top:1px solid var(--line); padding:6px 4px calc(6px + env(safe-area-inset-bottom));
        box-shadow:0 -2px 14px rgba(21,25,43,0.05); }
      .nav-item { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
        background:none; border:none; padding:5px 2px 3px; color:var(--muted); font-family:inherit; cursor:pointer; transition:.15s; }
      .nav-item:hover { color:var(--ink); }
      .nav-item.nav-active { color:var(--accent); }
      .nav-item.nav-active svg, .nav-item.nav-active .nav-date { filter:drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 45%, transparent)); }
      .nav-label { font-size:10px; font-weight:600; letter-spacing:0.02em; }
      .nav-date { font-family:var(--font-mono),monospace; font-size:12px; font-weight:600; line-height:1;
        width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center;
        border:1.5px solid currentColor; border-radius:6px; }

      .content { padding:6px 18px; }
      .stack { display:flex; flex-direction:column; gap:14px; }

      .card { background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:0 2px 14px rgba(21,25,43,0.07); }
      .card h3 { margin:0 0 10px; font-size:16px; font-weight:700; letter-spacing:-0.01em; }
      .card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .card-head h3 { margin:0; }
      .clickable { cursor:pointer; }
      .empty { text-align:center; color:var(--muted); padding:34px 18px; }

      .review-card { border-left:3px solid var(--line); }
      .review-accent { border-left-color:var(--positive); }
      .review-warn { border-left-color:var(--amber); }
      .review-base { border-left-color:var(--line); }

      .toast { position:fixed; left:50%; bottom:calc(78px + env(safe-area-inset-bottom)); transform:translateX(-50%); z-index:1000; display:flex; align-items:center; gap:12px; max-width:calc(100% - 32px); width:max-content; padding:12px 14px; background:var(--panel); border:1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,0.15); color:var(--ink); font-size:14px; line-height:1.4; animation:toast-in 0.25s ease-out; }
      .toast span { flex:1; }
      .toast .link-btn { flex-shrink:0; background:none; border:none; padding:0; color:var(--accent); font-size:14px; font-weight:600; cursor:pointer; white-space:nowrap; }
      .toast .toast-close { flex-shrink:0; background:none; border:none; padding:0 2px; color:var(--muted); font-size:16px; line-height:1; cursor:pointer; }
      .toast .toast-close:hover { color:var(--ink); }
      @keyframes toast-in { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }

      .hero { background:linear-gradient(135deg, var(--panel-2), var(--panel)); }
      .hero-row { display:flex; gap:10px; flex-wrap:wrap; }
      /* Four stats in a wrapping flex row leave the last one alone on its own
         line, stretched the full card width. Grid keeps them an even 2×2. */
      .hero-row.quad { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }
      @media (min-width:560px){ .hero-row.quad { grid-template-columns:repeat(4, minmax(0, 1fr)); } }
      .stat { flex:1; min-width:80px; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px; }
      .stat-val { font-size:24px; font-weight:600; letter-spacing:-0.02em; }
      .stat-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-top:4px; }

      .week-hub-row { display:flex; align-items:center; gap:20px; }
      .ring { flex-shrink:0; }
      .ring-val { fill:var(--ink); font-size:27px; font-weight:800; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
      .ring-sub { fill:var(--muted); font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
      .week-hub-side { flex:1; display:flex; flex-direction:column; gap:13px; min-width:0; }
      .wh-stat { display:flex; flex-direction:column; gap:1px; }
      .wh-num { font-size:20px; font-weight:800; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
      .wh-lbl { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
      .week-sessions { margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }

      .pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
      .pill-base { background:var(--panel-2); color:var(--muted); border:1px solid var(--line); }
      .pill-accent { background:color-mix(in srgb, var(--positive) 11%, transparent); color:var(--positive); border:1px solid color-mix(in srgb, var(--positive) 32%, transparent); }
      .pill-hard { background:color-mix(in srgb, var(--coral) 12%, transparent); color:var(--coral); border:1px solid color-mix(in srgb, var(--coral) 30%, transparent); }
      .pill-warn { background:color-mix(in srgb, var(--amber) 10%, transparent); color:var(--amber); border:1px solid color-mix(in srgb, var(--amber) 30%, transparent); }

      .sessions { display:flex; flex-direction:column; gap:8px; }
      .session { display:flex; align-items:center; gap:12px; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px; }
      .session-day { display:flex; flex-direction:column; align-items:center; justify-content:center; width:38px; flex-shrink:0; line-height:1.05; }
      .session-day .sd-dow { font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; }
      .session-day .sd-num { font-size:17px; font-weight:800; color:var(--accent); font-variant-numeric:tabular-nums; }
      .session-day .sd-mon { font-size:9.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; }
      .plan-week-head { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink); padding:10px 2px 2px; }
      .plan-week-head .muted { font-weight:600; letter-spacing:0; text-transform:none; }
      .session-body { flex:1; }
      .session-wrap { display:flex; flex-direction:column; }
      .session-skipped { opacity:0.5; }
      .session-skipped .session-title { text-decoration:line-through; }
      .session-overdue { border-color:color-mix(in srgb, var(--amber) 40%, transparent);
        background:color-mix(in srgb, var(--amber) 5%, var(--bg)); }
      .session-overdue .session-day .sd-num { color:var(--amber); }
      .sess-edit { color:var(--muted); font-size:15px; flex-shrink:0; }
      .session.clickable:hover .sess-edit { color:var(--accent); }

      /* session prescription, one row per step */
      .step-list { display:flex; flex-direction:column; gap:1px; background:var(--line);
        border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:0 0 12px; }
      .step-row { display:flex; align-items:flex-start; gap:12px; padding:9px 11px; background:var(--bg); }
      .step-dur { flex-shrink:0; width:52px; font-family:var(--font-mono),monospace; font-size:13px;
        font-weight:700; font-variant-numeric:tabular-nums; color:var(--accent); padding-top:1px; }
      .step-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
      .step-rep-line { display:flex; align-items:baseline; justify-content:space-between; gap:10px;
        font-size:13px; font-weight:600; }
      .step-rep-line.muted { font-size:12px; font-weight:500; }
      .step-rep-eff { font-weight:700; }
      .step-pace { flex-shrink:0; font-family:var(--font-mono),monospace; font-size:11.5px;
        font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums; }
      .step-reps { background:color-mix(in srgb, var(--accent) 5%, var(--bg)); }
      .step-reps .step-dur { font-size:14px; }
      .step-effort { font-size:11px; font-weight:600; color:var(--muted); text-transform:uppercase;
        letter-spacing:0.04em; margin-top:-1px; }
      .session-today { border-color:var(--accent-dim); }

      .watch-setup { margin:0 0 12px; }
      .watch-toggle { display:flex; align-items:center; justify-content:space-between; width:100%;
        background:transparent; border:1px dashed var(--line); border-radius:10px; padding:9px 11px;
        color:var(--muted); font-family:inherit; font-size:12.5px; font-weight:700; cursor:pointer; }
      .watch-toggle:hover { border-color:var(--accent-dim); color:var(--ink); }
      .watch-blocks { display:flex; flex-direction:column; gap:1px; background:var(--line);
        border:1px solid var(--line); border-radius:10px; overflow:hidden; margin-top:8px; }
      .watch-block { display:flex; align-items:baseline; gap:8px; padding:8px 11px; background:var(--bg);
        font-size:12.5px; }
      .wb-name { flex:1; min-width:0; font-weight:700; }
      .wb-dur, .wb-target, .wb-reps { font-family:var(--font-mono),monospace; font-variant-numeric:tabular-nums; }
      .wb-dur { width:52px; text-align:right; font-weight:700; color:var(--accent); }
      .wb-target { width:104px; text-align:right; color:var(--muted); font-size:11.5px; }
      .wb-reps { width:26px; text-align:right; font-weight:700; color:var(--muted); }

      .sess-editor { background:var(--panel-2); border:1px solid var(--line); border-top:none;
        border-radius:0 0 12px 12px; margin:-6px 0 0; padding:14px 12px 12px; }
      .sess-editor-lbl { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); font-weight:600; margin-bottom:8px; }
      .day-picker { display:flex; gap:6px; flex-wrap:wrap; }
      .day-chip { display:flex; flex-direction:column; align-items:center; gap:1px; width:42px; padding:7px 0; border-radius:10px;
        border:1px solid var(--line); background:var(--bg); color:var(--ink); font-family:inherit; cursor:pointer; transition:.12s; }
      .day-chip:hover { border-color:var(--accent-dim); }
      .day-chip.on { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
      .day-chip.gone { opacity:.32; cursor:default; }
      .day-chip.gone:hover { border-color:var(--line); }
      .day-chip .dc-dow { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; }
      .day-chip .dc-num { font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; }
      .sess-editor-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }

      .wk-head-l { display:flex; flex-direction:column; gap:2px; }
      .wk-range { margin-top:1px; }
      .session-title { font-weight:700; font-size:14px; }
      .session-detail { font-size:12.5px; color:var(--muted); margin-top:3px; line-height:1.45; }

      .session.pick { width:100%; text-align:left; color:var(--ink); font:inherit; cursor:pointer; transition:.15s; }
      .session.pick:hover { border-color:var(--accent-dim); }
      .session.pick:disabled { opacity:.5; cursor:default; }
      .session.pick.on { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 6%, transparent); }
      .session.pick.sug { border-color:var(--accent-dim); }

      .week-card.week-current { border-color:var(--accent-dim); }
      .sess-mark { font-family:var(--font-mono),monospace; font-size:13px; font-weight:700; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; flex-shrink:0; }
      .sess-mark.done { color:var(--positive); background:color-mix(in srgb, var(--positive) 11%, transparent); border:1px solid color-mix(in srgb, var(--positive) 32%, transparent); }
      .sess-mark.miss { color:var(--coral); background:color-mix(in srgb, var(--coral) 10%, transparent); border:1px solid color-mix(in srgb, var(--coral) 25%, transparent); }

      .warmup-card { border-color:color-mix(in srgb, var(--accent) 25%, transparent); }
      .warmup { margin:10px 0 0; padding-left:20px; }
      .warmup li { font-size:13.5px; margin-bottom:7px; line-height:1.45; }
      .muted { color:var(--muted); font-size:13.5px; line-height:1.55; }
      .small { font-size:12px; }

      .btn-primary { background:var(--accent); color:var(--on-accent); border:none; border-radius:13px; padding:14px;
        font-family:inherit; font-weight:800; font-size:15px; cursor:pointer; transition:.15s;
        box-shadow:0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent); }
      .btn-primary:hover { background:color-mix(in srgb, var(--accent) 82%, white); }
      .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
      .btn-ghost { background:transparent; border:1px solid var(--line); color:var(--ink); border-radius:10px;
        padding:7px 12px; font-family:inherit; font-size:13px; cursor:pointer; font-weight:600; }
      .btn-ghost:hover { border-color:var(--accent-dim); }
      .btn-ghost.wide { width:100%; padding:12px; }
      /* an <a> styled as a button: buttons centre their text, anchors don't */
      .btn-link { display:block; text-align:center; font-weight:700; font-size:14px; }
      .btn-primary.slim { padding:10px 16px; font-size:14px; }
      .span-2 { grid-column:1 / -1; }

      .fitness-banner { display:flex; align-items:center; gap:14px; justify-content:space-between;
        background:linear-gradient(135deg, color-mix(in srgb, var(--positive) 9%, transparent), var(--panel)); border-color:color-mix(in srgb, var(--positive) 35%, transparent); flex-wrap:wrap; }
      .fitness-banner p { margin:4px 0 0; }
      .fitness-banner strong { font-size:15px; }
      .fitness-banner .btn-primary { flex-shrink:0; }

      .warmup-timer { margin-top:12px; background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:18px; text-align:center; }
      .wu-steps { display:flex; gap:6px; justify-content:center; margin-bottom:14px; }
      .wu-dot { width:34px; height:5px; border-radius:999px; background:var(--line); transition:.3s; }
      .wu-dot.on { background:var(--accent); }
      .wu-dot.past { background:var(--accent-dim); }
      .wu-label { font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--accent); font-weight:700; }
      .wu-time { font-family:var(--font-mono),monospace; font-size:44px; font-weight:600; letter-spacing:-0.02em; margin:4px 0; }
      .wu-sub { font-size:13px; max-width:340px; margin:0 auto 14px; line-height:1.5; }
      .wu-controls { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
      .wu-done { padding:6px 0; }
      .wu-done .wu-time { font-size:30px; }

      /* minmax(0,1fr), not 1fr: a grid track's default min is min-content, so a
         date input's intrinsic width (locale format + calendar icon) pushed the
         track wider than the card and spilled off the right edge. */
      .form-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
      .field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--muted); font-weight:600; margin-bottom:10px; min-width:0; }
      .field span { text-transform:uppercase; letter-spacing:0.05em; font-size:11px; }
      input, select, textarea { background:var(--bg); border:1px solid var(--line); color:var(--ink);
        border-radius:10px; padding:11px; font-family:inherit; font-size:14px; width:100%; min-width:0; max-width:100%; }
      /* Safari gives date inputs a fixed intrinsic width that ignores width:100%
         unless the native appearance is off. */
      input[type="date"] { -webkit-appearance:none; appearance:none; }
      input[type="date"]::-webkit-date-and-time-value { text-align:left; margin:0; }
      input[type="date"]::-webkit-calendar-picker-indicator { margin-left:0; }
      input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent-dim); }
      textarea { resize:vertical; }

      .pace-readout { margin-top:8px; font-size:14px; }
      .warn { color:var(--amber); font-size:13px; }

      .slider { -webkit-appearance:none; width:100%; height:8px; border-radius:999px;
        background:linear-gradient(90deg,var(--coral),var(--amber),var(--positive)); margin:8px 0 4px; }
      .slider::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px; border-radius:50%;
        background:var(--panel); border:3px solid var(--ink); cursor:pointer; }
      .slider-ends { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); }
      .score-big { font-size:22px; font-weight:600; }

      .check-row { display:flex; align-items:center; gap:10px; margin-top:14px; font-size:14px; cursor:pointer; }
      .check-row input { width:18px; height:18px; }

      .chips { display:flex; flex-wrap:wrap; gap:8px; }
      .chip { background:var(--bg); border:1px solid var(--line); color:var(--muted); border-radius:999px;
        padding:8px 13px; font-family:inherit; font-size:13px; cursor:pointer; transition:.12s; font-weight:600; }
      .chip:hover { color:var(--ink); }
      .chip-on { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
      .chip-pain { background:var(--coral); color:var(--on-accent); border-color:var(--coral); }

      .row-item { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-top:1px solid var(--line); font-size:14px; }
      .row-item.col { flex-direction:column; align-items:stretch; gap:6px; }
      .row-item:first-of-type { border-top:none; }
      .row-gap { display:flex; gap:8px; align-items:center; }

      .run-item { border-top:1px solid var(--line); padding:13px 0; }
      .run-item:first-of-type { border-top:none; }
      .run-main { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .run-type { font-weight:700; font-size:14px; }
      .run-meta { font-size:12.5px; color:var(--muted); margin-top:2px; }
      .run-feel { margin-top:5px; font-weight:600; font-size:13px; }
      .pain-tag { color:var(--coral); }
      .run-notes { font-style:italic; color:var(--muted); font-size:13px; margin-top:5px; }
      .run-foot { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }

      /* Activities run rows — share the polished Plan session-card styling. */
      .run-card { margin-top:8px; }
      .run-card:first-of-type { margin-top:10px; }
      .run-row { align-items:flex-start; }
      .run-title-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .run-score-cell { display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0; }
      .run-score { font-weight:800; font-size:14px; font-variant-numeric:tabular-nums; }
      .run-card .run-foot { justify-content:flex-end; margin-top:4px; }
      .del { background:none; border:none; color:var(--coral); font-size:12px; cursor:pointer; font-family:inherit; opacity:.7; }
      .del:hover { opacity:1; }

      .fuel-head { display:flex; justify-content:space-between; align-items:center; }
      .meal { display:flex; gap:10px; font-size:13.5px; padding:2px 0; }
      .meal span { color:var(--accent); font-weight:700; min-width:18px; font-family:var(--font-mono),monospace; font-size:12px; }
      .note-card { background:var(--panel-2); }

      .insight p { font-size:14px; line-height:1.6; margin:0; }
      .bars { display:flex; flex-direction:column; gap:9px; }
      .bar-row { display:flex; align-items:center; gap:10px; }
      .bar-label { font-size:13px; width:130px; flex-shrink:0; }
      .bar-track { flex:1; height:9px; background:var(--bg); border-radius:999px; overflow:hidden; }
      .bar-fill { height:100%; background:var(--accent); border-radius:999px; }
      .bar-n { font-family:var(--font-mono),monospace; font-size:12px; color:var(--muted); width:20px; text-align:right; }

      .vol-chart { display:flex; align-items:flex-end; gap:6px; height:96px; margin-bottom:6px; }
      .vol-col { flex:1; display:flex; align-items:flex-end; height:100%; }
      .vol-bar { width:100%; background:var(--accent); border-radius:6px 6px 0 0; min-height:2px; }
      .vol-axis { display:flex; justify-content:space-between; }

      .pace-table { margin-top:12px; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:6px 14px; }
      .pt-section { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent-dim); padding:12px 0 6px; font-weight:600; }
      .pt-row { display:flex; justify-content:space-between; padding:6px 0; border-top:1px solid var(--line); font-size:13.5px; }
      .pt-zone { color:var(--ink); }
      .pt-pace { color:var(--accent); font-weight:600; }
      .chev { color:var(--muted); }

      .sync { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
      .effort-add { background:none; border:1px dashed var(--line); color:var(--muted); border-radius:999px;
        padding:3px 10px; font-family:inherit; font-size:12px; cursor:pointer; font-weight:600; }
      .effort-add:hover { color:var(--ink); border-color:var(--accent-dim); }
      .effort-pick { display:inline-flex; gap:3px; flex-wrap:wrap; vertical-align:middle; }
      .effort-chip { width:26px; height:26px; border-radius:7px; border:1px solid var(--line);
        background:var(--bg); color:var(--ink); font-family:inherit; font-size:12px; cursor:pointer; }
      .effort-chip:hover:not(:disabled) { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
      .effort-chip:disabled { opacity:.4; cursor:default; }

      .back-btn { align-self:flex-start; }
      .detail-meta { display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; }
      .chart-placeholder { background:var(--panel-2); text-align:center; }
      .run-chev { margin-left:auto; color:var(--muted); font-size:18px; }
      .run-main.clickable:hover .run-chev { color:var(--accent); }
      .splits-table { display:flex; flex-direction:column; }
      .srow { display:grid; grid-template-columns:44px 1fr 1fr 1fr; gap:8px; padding:8px 0; border-top:1px solid var(--line); font-size:13.5px; align-items:center; }
      .srow:first-of-type { border-top:none; }
      .shead { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; }

      .chart-tip { background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:8px 10px; font-size:12.5px; line-height:1.5; }
      .chart-tip-t { color:var(--muted); font-size:11px; margin-bottom:4px; }
      .chip .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }

      .chart-tip-wrap { display:flex; flex-direction:column; gap:6px; max-width:240px; }
      .chart-tip-song { padding:7px 8px; }

      /* shared album-art + title + artist cell */
      .song-cell { display:flex; align-items:center; gap:10px; min-width:0; }
      .song-art { width:40px; height:40px; border-radius:7px; object-fit:cover; flex-shrink:0; background:var(--bg); }
      .song-art-ph { display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:18px; }
      .song-meta { min-width:0; }
      .song-title { font-weight:700; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .song-artist { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      /* chart focus pin (jumped-to moment from the setlist) */
      .chart-pin { margin-top:10px; padding:10px 12px; background:var(--panel-2); border:1px solid var(--line); border-radius:12px; display:flex; flex-direction:column; gap:8px; }
      .chart-pin-data { display:flex; align-items:center; gap:14px; font-size:13px; }
      .chart-pin-data > strong { color:var(--ink); }
      .pin-close { margin-left:auto; background:none; border:none; color:var(--muted); cursor:pointer; font-size:13px; padding:2px 4px; }
      .pin-close:hover { color:var(--ink); }

      /* per-activity setlist */
      .setlist { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
      .setlist-row { display:flex; align-items:center; gap:8px; }
      .setlist-main { flex:1; min-width:0; display:flex; align-items:center; gap:12px; background:var(--bg); border:1px solid var(--line);
        border-radius:12px; padding:8px 12px; cursor:pointer; font-family:inherit; text-align:left; color:var(--ink); transition:.12s; }
      .setlist-main:hover { border-color:var(--accent-dim); }
      .setlist-time { color:var(--accent); font-size:12px; width:40px; flex-shrink:0; }
      .setlist-spotify { flex-shrink:0; font-size:12px; font-weight:700; color:var(--positive); white-space:nowrap;
        border:1px solid color-mix(in srgb, var(--positive) 35%, transparent); border-radius:999px; padding:6px 10px; }
      .setlist-spotify:hover { background:color-mix(in srgb, var(--positive) 12%, transparent); }

      /* insights song lists (leaderboard / hardest / fastest) */
      .song-list { display:flex; flex-direction:column; gap:10px; }
      .song-rank { display:flex; align-items:center; gap:12px; }
      .song-rank .song-cell { flex:1; }
      .song-stat { font-weight:700; font-size:13px; flex-shrink:0; }

      .zlist { display:flex; flex-direction:column; }
      .zrow { display:grid; grid-template-columns:14px 1fr auto; gap:10px; align-items:center; padding:7px 0; border-top:1px solid var(--line); font-size:13px; }
      .zrow:first-of-type { border-top:none; }
      .zdot { width:10px; height:10px; border-radius:3px; }
      .zname { font-weight:600; }
      .zpct { font-size:12px; text-align:right; }
      .test-pick { display:grid; grid-template-columns:1fr auto auto auto auto; gap:10px; align-items:center; width:100%; text-align:left; background:var(--bg); border:1px solid var(--line); color:var(--ink); border-radius:10px; padding:10px 12px; font-family:inherit; font-size:13px; cursor:pointer; margin-bottom:6px; }
      .test-pick:hover:not(:disabled) { border-color:var(--accent-dim); }
      .test-pick:disabled { opacity:.5; }
      .test-go { color:var(--accent); font-weight:600; }

      .zbar { display:flex; height:14px; border-radius:999px; overflow:hidden; background:var(--bg); margin-bottom:12px; }
      .zbar-seg { min-width:2px; }
      .zrow { grid-template-columns:14px 1fr auto auto; }
      .ztime { font-size:12px; text-align:right; }
      .zshare { color:var(--accent); text-align:right; min-width:40px; }

      .run-group { margin-top:18px; }
      .run-group:first-of-type { margin-top:4px; }
      .run-group { margin-top:10px; }
      .run-group:first-of-type { margin-top:0; }
      .run-group-head { display:flex; align-items:center; gap:10px; width:100%; padding:12px 14px; margin-bottom:2px; background:var(--panel-2); border:1px solid var(--line); border-radius:10px; cursor:pointer; font-family:inherit; text-align:left; }
      .run-group-head:hover { border-color:var(--accent-dim); }
      .run-group-chev { color:var(--accent); font-size:12px; width:12px; }
      .run-group-label { font-weight:800; font-size:14px; letter-spacing:0.05em; text-transform:uppercase; }
      .run-group-meta { margin-left:auto; }
      .zitem { padding:9px 0; border-top:1px solid var(--line); }
      .zitem:first-of-type { border-top:none; }
      .zitem .zrow { border-top:none; padding:0; }
      .zone-note { margin:4px 0 0 24px; }

      .sub-h { font-size:13px; font-weight:700; margin:16px 0 8px; }

      @media (max-width:520px){ .form-grid { grid-template-columns:1fr; } .bar-label{width:96px;} }
    `}</style>
  );
}