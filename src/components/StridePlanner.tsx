// @ts-nocheck
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";

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

const ZONE_META = {
  easy: { name: "Easy / Zone 2", note: "Conversational. Talk in full sentences. This is most of your running." },
  long: { name: "Long run", note: "Easy effort, sustained. Build endurance and fatigue resistance." },
  marathon: { name: "Marathon pace", note: "Steady, controlled, 'comfortably hard'." },
  tempo: { name: "Tempo / Threshold", note: "Comfortably hard. ~1hr race effort. Builds your lactate ceiling." },
  interval: { name: "Interval / VO2", note: "Hard. 3–5min reps. Lifts top-end aerobic power." },
  reps: { name: "Reps / Strides", note: "Fast & short. Form, economy, leg speed. Stay relaxed." },
};

/* ---------- plan generation ---------- */

function weeksBetween(fromISO, toISO) {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  const ms = b - a;
  return Math.max(0, Math.round(ms / (7 * 24 * 3600 * 1000)));
}

function generatePlan(profile) {
  const { goalDistanceKm, raceDate, currentWeeklyKm, daysPerWeek } = profile;
  if (!goalDistanceKm || !raceDate || !currentWeeklyKm) return [];
  const totalWeeks = Math.min(24, Math.max(4, weeksBetween(new Date().toISOString(), raceDate)));
  const days = Math.min(6, Math.max(2, daysPerWeek || 4));

  // taper length scales with goal distance
  const taper = goalDistanceKm >= 30 ? 3 : goalDistanceKm >= 15 ? 2 : 1;
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
    weeks.push(buildWeek(w, totalWeeks, weekVol, goalDistanceKm, days, isTaper, cutback));
  }
  return weeks;
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

function buildWeek(idx, total, weekVol, goalKm, days, isTaper, cutback) {
  // long run grows toward ~ goalKm (capped for safety) but eased in taper
  const longCap = goalKm <= 10 ? goalKm * 1.0 : goalKm <= 21.1 ? goalKm * 0.95 : goalKm * 0.80;
  const progress = Math.min(1, (idx + 1) / Math.max(1, total - 2));
  let longKm = Math.round(Math.min(longCap, Math.max(goalKm * 0.35, longCap * progress)));
  if (isTaper) longKm = Math.round(longKm * 0.7);

  const sessions = [];
  // 1 long
  sessions.push({ day: "Sun", type: "long", km: longKm });
  // quality sessions: alternate tempo / interval. fewer during taper/cutback
  const qualityCount = isTaper || cutback ? 1 : days >= 5 ? 2 : 1;
  if (qualityCount >= 1) sessions.push({ day: "Tue", type: idx % 2 === 0 ? "tempo" : "interval", quality: true });
  if (qualityCount >= 2) sessions.push({ day: "Thu", type: idx % 2 === 0 ? "interval" : "tempo", quality: true });

  // fill remaining days with easy/zone2 runs to hit volume
  const usedDays = sessions.length;
  const easyDays = Math.max(0, days - usedDays);
  const remaining = Math.max(0, weekVol - longKm - qualityCount * 6); // assume ~6km per quality incl w/u
  const perEasy = easyDays > 0 ? Math.max(4, Math.round(remaining / easyDays)) : 0;
  const easyLabels = ["Mon", "Wed", "Fri", "Sat"];
  for (let i = 0; i < easyDays; i++) {
    sessions.push({ day: easyLabels[i] || `Day${i}`, type: "easy", km: perEasy });
  }

  return {
    week: idx + 1,
    volume: weekVol,
    label: isTaper ? "Taper" : cutback ? "Recovery week" : idx === 0 ? "Base" : "Build",
    sessions,
  };
}

function sessionDescription(s, zones) {
  const pz = zones && zones[s.type];
  const paceStr = pz ? `${fmtPace(pz[0])}–${fmtPace(pz[1])}` : "by feel";
  if (s.type === "tempo") {
    const tp = zones && zones.tempo;
    return { title: "Tempo / Threshold", detail: `15min easy w/u → 20–25min @ ${tp ? fmtPace(tp[1]) + "–" + fmtPace(tp[0]) : "comfortably hard"} → 10min easy c/d` };
  }
  if (s.type === "interval") {
    const ip = zones && zones.interval;
    return { title: "Intervals (VO2)", detail: `15min easy w/u + strides → 5 × 3min @ ${ip ? fmtPace(ip[1]) : "hard"} w/ 90s jog → 10min easy c/d` };
  }
  if (s.type === "long") {
    const lp = zones && zones.long;
    return { title: `Long run · ${s.km}km`, detail: `Steady & easy @ ${lp ? fmtPace(lp[0]) + "–" + fmtPace(lp[1]) : "conversational"}. Practice fuelling on anything over 90min.` };
  }
  return { title: `Easy / Zone 2 · ${s.km}km`, detail: `Truly easy @ ${paceStr}. If you can't talk in full sentences, slow down.` };
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
    raceDate: row.race_date || "",
    currentWeeklyKm: row.current_weekly_km != null ? Number(row.current_weekly_km) : null,
    daysPerWeek: row.days_per_week,
    benchDistKm: row.bench_dist_km != null ? Number(row.bench_dist_km) : null,
    benchTimeSec: row.bench_time_s,
    easyPaceSec: row.easy_pace_s,
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
    race_date: p.raceDate ? p.raceDate : null,
    current_weekly_km: p.currentWeeklyKm ?? null,
    days_per_week: p.daysPerWeek ?? null,
    bench_dist_km: p.benchDistKm ?? null,
    bench_time_s: p.benchTimeSec ?? null,
    easy_pace_s: p.easyPaceSec ?? null,
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
    type: activity.type || (log && log.run_type) || "easy",
    distance: d != null ? d.toFixed(2) : "0.00",
    timeSec: activity.moving_time_s ?? 0,
    score:
      log && log.score != null
        ? log.score
        : activity.perceived_exertion != null
        ? Number(activity.perceived_exertion)
        : null,
    warmup: log ? !!log.warmup : false,
    wrong: (log && log.wrong) || [],
    pain: (log && log.pain) || [],
    notes: (log && log.notes) || "",
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

// set a manual effort score (1-10) on an activity that has none (e.g. a Strava import).
async function setActivityEffort(activityId, score) {
  const supabase = sb();
  const { error } = await supabase
    .from("activities")
    .update({ perceived_exertion: score, effort_source: "manual" })
    .eq("id", activityId);
  if (error) throw error;
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

/* ---------- main app ---------- */

const TABS = [
  ["today", "Today"],
  ["plan", "Plan"],
  ["log", "Log Run"],
  ["activity", "Activity"],
  ["fuel", "Fuel"],
  ["insights", "Insights"],
  ["setup", "Setup"],
];

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("today");
  const [profile, setProfile] = useState(null);
  const [plan, setPlan] = useState([]);
  const [runs, setRuns] = useState([]);
  const [cross, setCross] = useState([]);
  const [fuel, setFuel] = useState([]);
  const reloadRuns = useCallback(async () => {
    const r = await loadRuns();
    setRuns(r);
  }, []);

  useEffect(() => {
    (async () => {
      const [p, r, c, f] = await Promise.all([
        loadKey(KEYS.profile, null),
        loadRuns(),
        loadCross(),
        loadFuel(),
      ]);
      setProfile(p);
      setPlan(p ? generatePlan(p) : []); // plan is derived from profile, not stored
      setRuns(r);
      setCross(c);
      setFuel(f);
      setLoaded(true);
      if (!p) setTab("setup");
    })();
  }, []);

  const zones = computeZones(profile);

  const saveProfile = useCallback((p) => {
    setProfile(p);
    saveKey(KEYS.profile, p);
    setPlan(generatePlan(p)); // derived, no longer persisted
  }, []);

  const addRun = async (run) => {
    try {
      const saved = await insertRun(run);
      setRuns((prev) => [saved, ...prev]);
    } catch (e) {
      console.error("add run failed", e);
    }
  };
  const updateFitness = (distKm, timeSec) => {
    const p = { ...profile, benchDistKm: distKm, benchTimeSec: timeSec };
    saveProfile(p);
  };
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
        <div className="brand">
          <svg className="logo" viewBox="0 0 64 64" aria-label="Stride logo">
            <g fill="none" stroke="var(--accent)" strokeWidth="6.5" strokeLinecap="round">
              <path d="M16 24 L23 13" />
              <path d="M24 40 L35 23" />
              <path d="M32 56 L47 33" />
            </g>
          </svg>
          <span className="brand-word">STRIDE<span className="brand-dot">.</span></span>
          <span className="brand-sub">running planner</span>
        </div>
        {profile && profile.name ? <div className="hello">Hi, {profile.name}</div> : null}
      </header>

      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "today" && <Today profile={profile} plan={plan} runs={runs} zones={zones} go={setTab} onUpdateFitness={updateFitness} />}
        {tab === "plan" && <PlanView plan={plan} zones={zones} profile={profile} />}
        {tab === "log" && <LogRun profile={profile} zones={zones} onSave={addRun} fuel={fuel} />}
        {tab === "activity" && <Activity runs={runs} cross={cross} onDelRun={delRun} onAddCross={addCross} onReloadRuns={reloadRuns} zones={zones} />}
        {tab === "fuel" && <FuelView fuel={fuel} onSave={addFuel} runs={runs} />}
        {tab === "insights" && <Insights runs={runs} fuel={fuel} zones={zones} />}
        {tab === "setup" && <Setup profile={profile} onSave={saveProfile} zones={zones} />}
      </main>
    </div>
  );
}

/* ---------- TODAY ---------- */

function Today({ profile, plan, runs, zones, go, onUpdateFitness }) {
  if (!profile) return <Empty msg="Head to Setup to get started." />;
  const wk = currentWeek(profile, plan);
  const last = runs[0];
  const weekKm = runs
    .filter((r) => withinDays(r.date, 7))
    .reduce((a, r) => a + (parseFloat(r.distance) || 0), 0);
  const fitness = fitnessUpdateSuggestion(profile, runs);

  return (
    <div className="stack">
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
          <Stat label="Race day" value={profile.raceDate ? daysUntil(profile.raceDate) + "d" : "—"} />
          <Stat label="This week" value={`${weekKm.toFixed(1)}km`} />
        </div>
      </section>

      {wk && (
        <section className="card">
          <div className="card-head">
            <h3>Week {wk.week} · {wk.label}</h3>
            <Pill tone="accent">{wk.volume}km planned</Pill>
          </div>
          <div className="sessions">
            {wk.sessions.map((s, i) => {
              const d = sessionDescription(s, zones);
              return (
                <div key={i} className="session">
                  <div className="session-day">{s.day}</div>
                  <div className="session-body">
                    <div className="session-title">{d.title}</div>
                    <div className="session-detail">{d.detail}</div>
                  </div>
                  {s.quality && <Pill tone="hard">quality</Pill>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card warmup-card">
        <h3>🔑 Warm-up — do this before every quality session & race</h3>
        <p className="muted">
          That "takes 4–5km to feel decent" thing is your body warming up. So don't spend race day
          or a hard session doing it at speed — warm up first and start <strong>already warm</strong>.
          Tap start and follow along:
        </p>
        <WarmupTimer />
      </section>

      {last && (
        <section className="card">
          <div className="card-head"><h3>Last run</h3><span className="muted">{relDate(last.date)}</span></div>
          <div className="hero-row">
            <Stat label="Type" value={ZONE_META[last.type] ? ZONE_META[last.type].name.split(" ")[0] : last.type} />
            <Stat label="Distance" value={`${last.distance}km`} />
            <Stat label="Pace" value={fmtPace(paceOf(last))} />
            <Stat label="Score" value={last.score != null ? `${last.score}/10` : "—"} accent />          
          </div>
        </section>
      )}

      <button className="btn-primary" onClick={() => go("log")}>＋ Log a run</button>
    </div>
  );
}

/* ---------- guided warm-up ---------- */

const WARMUP_STEPS = [
  { label: "Easy jog", sub: "Properly easy. Slower than feels natural — you're just raising the temperature.", sec: 600 },
  { label: "Dynamic drills", sub: "Leg swings, walking lunges, hip openers, ankle circles.", sec: 120 },
  { label: "Strides", sub: "4–6 × ~20s, building to fast-but-relaxed. Walk back to recover between each.", sec: 180 },
  { label: "Settle", sub: "Shake the legs out, easy breathing, then start your session warm.", sec: 60 },
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

function PlanView({ plan, zones, profile }) {
  const [open, setOpen] = useState(null);
  if (!profile) return <Empty msg="Set your goal in Setup to generate a plan." />;
  if (!plan.length) return <Empty msg="No plan yet — check your goal date in Setup." />;
  return (
    <div className="stack">
      <section className="card">
        <h3>{profile.goalLabel || `${profile.goalDistanceKm}km`} · {plan.length}-week plan</h3>
        <p className="muted">
          Built on the 80/20 principle: most running easy, a controlled dose of hard. Volume rises
          ~10%/week with a recovery week every 4th, then a taper. Tap a week for sessions.
        </p>
      </section>
      {plan.map((w) => (
        <section key={w.week} className="card week-card">
          <div className="card-head clickable" onClick={() => setOpen(open === w.week ? null : w.week)}>
            <h3>Week {w.week} <span className="muted">· {w.label}</span></h3>
            <div className="row-gap">
              <Pill tone="accent">{w.volume}km</Pill>
              <span className="chev">{open === w.week ? "▾" : "▸"}</span>
            </div>
          </div>
          {open === w.week && (
            <div className="sessions">
              {w.sessions.map((s, i) => {
                const d = sessionDescription(s, zones);
                return (
                  <div key={i} className="session">
                    <div className="session-day">{s.day}</div>
                    <div className="session-body">
                      <div className="session-title">{d.title}</div>
                      <div className="session-detail">{d.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/* ---------- LOG RUN ---------- */

const WRONG_OPTIONS = [
  "Started too fast", "Tired / low energy", "Breathing felt off",
  "Legs heavy / dead", "GI issues", "Too hot / humid",
  "Under-fuelled", "Poor sleep", "Stressed / distracted", "Pain",
];
const PAIN_AREAS = [
  "Knee (front)", "Knee (outside / ITB)", "Shin", "Calf", "Achilles",
  "Foot / arch", "Hamstring", "Hip / glute", "Lower back", "Ankle",
];
const RUN_TYPES = ["easy", "long", "tempo", "interval", "reps", "marathon", "race", "other"];

function LogRun({ profile, zones, onSave, fuel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [type, setType] = useState("easy");
  const [distance, setDistance] = useState("");
  const [time, setTime] = useState("");
  const [score, setScore] = useState(7);
  const [warmup, setWarmup] = useState(false);
  const [wrong, setWrong] = useState([]);
  const [pain, setPain] = useState([]);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const toggle = (arr, set, v) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const livePace = distance && time ? parseTime(time) / parseFloat(distance) : 0;

  const submit = () => {
    if (!distance || !time) return;
    onSave({
      id: Date.now(),
      date, type,
      distance: parseFloat(distance).toFixed(2),
      timeSec: parseTime(time),
      score: Number(score),
      warmup,
      wrong: score <= 6 ? wrong : [],
      pain: wrong.includes("Pain") || pain.length ? pain : [],
      notes,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
    setDistance(""); setTime(""); setScore(7); setWrong([]); setPain([]); setNotes(""); setWarmup(false);
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
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {RUN_TYPES.map((t) => (
                <option key={t} value={t}>{ZONE_META[t] ? ZONE_META[t].name : cap(t)}</option>
              ))}
            </select>
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
            {zones && type === "easy" && livePace < zones.easy[1] && (
              <span className="warn"> ⚠ faster than your easy zone ({fmtPace(zones.easy[1])}) — easy runs should feel boringly slow.</span>
            )}
          </div>
        )}
      </section>

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

      {(wrong.includes("Pain") || pain.length > 0) && (
        <section className="card">
          <h3>Where did it hurt?</h3>
          <p className="muted">Logging this builds a picture over time. Persistent pain in one spot is worth showing a physio.</p>
          <div className="chips">
            {PAIN_AREAS.map((o) => (
              <button key={o} className={`chip ${pain.includes(o) ? "chip-pain" : ""}`} onClick={() => toggle(pain, setPain, o)}>{o}</button>
            ))}
          </div>
        </section>
      )}

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

function Activity({ runs, cross, onDelRun, onAddCross, onReloadRuns, zones }) {
  const [showCross, setShowCross] = useState(false);
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
        {showCross && <CrossForm onAdd={(x) => { onAddCross(x); setShowCross(false); }} />}
        {cross.length === 0 && !showCross && <p className="muted">No cross-training logged. Pilates, swimming, cycling, strength — it all counts.</p>}
        {cross.map((c) => (
          <div key={c.id} className="row-item">
            <div><strong>{cap(c.activity)}</strong> · {c.minutes}min · {c.intensity}</div>
            <span className="muted">{relDate(c.date)}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Run history</h3>
        {runs.length === 0 && <p className="muted">No runs yet.</p>}
        {runs.map((r) => (
          <div key={r.id} className="run-item">
            <div className="run-main">
              <span className="run-type">{ZONE_META[r.type] ? ZONE_META[r.type].name : cap(r.type)}</span>
              <span className="run-meta">{r.distance}km · {fmtTime(r.timeSec)} · {fmtPace(paceOf(r))}</span>
              {r.warmup && <Pill tone="accent">warmed up</Pill>}
            </div>
            <div className="run-feel">
              {r.score != null ? (
                <span style={{ color: scoreColor(r.score) }}>{r.score}/10</span>
              ) : (
                <EffortAdder activityId={r.id} onSet={onReloadRuns} />
              )}
              {r.wrong && r.wrong.length > 0 && <span className="muted small"> · {r.wrong.join(", ")}</span>}
              {r.pain && r.pain.length > 0 && <span className="pain-tag"> · 🩹 {r.pain.join(", ")}</span>}
            </div>
            {r.notes && <div className="run-notes">"{r.notes}"</div>}
            <div className="run-foot">
              <span className="muted small">{relDate(r.date)}</span>
              <button className="del" onClick={() => onDelRun(r.id)}>delete</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// Inline 1-10 picker shown on runs that have no effort score yet.
function EffortAdder({ activityId, onSet }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (v) => {
    setBusy(true);
    try { await setActivityEffort(activityId, v); await onSet(); }
    catch (e) { console.error("set effort failed", e); setBusy(false); }
  };
  if (!open) return <button className="effort-add" onClick={() => setOpen(true)}>＋ effort</button>;
  return (
    <span className="effort-pick">
      {[1,2,3,4,5,6,7,8,9,10].map((v) => (
        <button key={v} className="effort-chip" disabled={busy} onClick={() => pick(v)}>{v}</button>
      ))}
    </span>
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

const CARB_HINTS = ["rice", "pasta", "bread", "toast", "oat", "potato", "banana", "cereal", "noodle", "bagel", "honey", "fruit", "wrap", "rolled", "muesli", "porridge"];
const PROTEIN_HINTS = ["egg", "chicken", "beef", "fish", "salmon", "tofu", "yoghurt", "yogurt", "protein", "beans", "lentil", "cheese", "milk", "tuna", "pork", "lamb"];

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
          const text = [f.breakfast, f.lunch, f.dinner, f.snacks].join(" ").toLowerCase();
          const hasCarb = CARB_HINTS.some((h) => text.includes(h));
          const hasProtein = PROTEIN_HINTS.some((h) => text.includes(h));
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

function Insights({ runs, fuel, zones }) {
  const scored = runs.filter((r) => r.score != null);
  if (scored.length < 3) return <Empty msg="Log or score a few runs and the patterns will show up here." />;

  const lowRuns = scored.filter((r) => r.score <= 6);
  const goodRuns = scored.filter((r) => r.score >= 8);

  // most common "what went wrong"
  const wrongTally = {};
  lowRuns.forEach((r) => (r.wrong || []).forEach((w) => (wrongTally[w] = (wrongTally[w] || 0) + 1)));
  const topWrong = Object.entries(wrongTally).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // pain tally
  const painTally = {};
  runs.forEach((r) => (r.pain || []).forEach((p) => (painTally[p] = (painTally[p] || 0) + 1)));
  const topPain = Object.entries(painTally).sort((a, b) => b[1] - a[1]);

  // warm-up effect
  const warmedScores = scored.filter((r) => r.warmup).map((r) => r.score);
  const coldScores = scored.filter((r) => !r.warmup).map((r) => r.score);
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);

  // easy runs run too hard
  const easyRuns = runs.filter((r) => r.type === "easy" && zones);
  const tooFastEasy = easyRuns.filter((r) => paceOf(r) < zones.easy[1]);

  // fuel correlation: low runs preceded by no carbs
  const fuelByDate = {};
  fuel.forEach((f) => (fuelByDate[f.date] = f));

  return (
    <div className="stack">
      <section className="card">
        <h3>What your data is telling you</h3>
        <div className="hero-row">
          <Stat label="Runs scored" value={scored.length} />
          <Stat label="Avg score" value={avg(scored.map((r) => r.score)) || "—"} accent />
          <Stat label="Warmed-up runs" value={`${Math.round((scored.filter(r=>r.warmup).length / scored.length) * 100)}%`} />
        </div>
      </section>

      {avg(warmedScores) && avg(coldScores) && (
        <section className="card insight">
          <h3>🔥 Warm-up effect</h3>
          <p>
            Runs where you warmed up score <strong style={{ color: "var(--accent)" }}>{avg(warmedScores)}/10</strong> on
            average, vs <strong style={{ color: "var(--coral)" }}>{avg(coldScores)}/10</strong> when you didn't.
            {Number(avg(warmedScores)) > Number(avg(coldScores)) + 0.5
              ? " That gap is your 4–5km problem in numbers — warming up first is the cheapest win you have."
              : " Keep logging — the picture will sharpen."}
          </p>
        </section>
      )}

      {topWrong.length > 0 && (
        <section className="card insight">
          <h3>🔎 Your tougher runs usually involve</h3>
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

      {tooFastEasy.length > 0 && (
        <section className="card insight">
          <h3>🐢 Easy runs aren't easy enough</h3>
          <p>
            {tooFastEasy.length} of your {easyRuns.length} easy runs were faster than your easy
            zone ({fmtPace(zones.easy[1])} or slower). Running easy days too hard is the classic
            reason every run feels mediocre — you never fully recover. Slow them down and your hard
            days get better.
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

      {goodRuns.length > 0 && (
        <section className="card insight">
          <h3>✅ On your best runs</h3>
          <p>
            {Math.round((goodRuns.filter((r) => r.warmup).length / goodRuns.length) * 100)}% of your
            8+ runs included a warm-up. Whatever you did on those days — repeat it.
          </p>
        </section>
      )}
    </div>
  );
}

/* ---------- SETUP ---------- */

function Setup({ profile, onSave, zones }) {
  const [name, setName] = useState(profile?.name || "");
  const [goalType, setGoalType] = useState(profile?.goalType || "distance");
  const [goalDistanceKm, setGoalDistanceKm] = useState(profile?.goalDistanceKm || 21.1);
  const [goalTime, setGoalTime] = useState(profile?.goalTime || "");
  const [raceDate, setRaceDate] = useState(profile?.raceDate || "");
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState(profile?.currentWeeklyKm || 25);
  const [daysPerWeek, setDaysPerWeek] = useState(profile?.daysPerWeek || 4);
  const [benchDist, setBenchDist] = useState(profile?.benchDistKm || 5);
  const [benchTime, setBenchTime] = useState(profile?.benchTimeSec ? fmtTime(profile.benchTimeSec) : "");
  const [easyPace, setEasyPace] = useState(profile?.easyPaceSec ? fmtTime(profile.easyPaceSec) : "");
  const [saved, setSaved] = useState(false);

  const submit = () => {
    const goalLabel =
      goalType === "time" && goalTime
        ? `${goalDistanceKm}km in ${goalTime}`
        : `${goalDistanceKm}km`;
    onSave({
      name, goalType,
      goalDistanceKm: parseFloat(goalDistanceKm),
      goalTime,
      goalLabel,
      raceDate,
      currentWeeklyKm: parseFloat(currentWeeklyKm),
      daysPerWeek: parseInt(daysPerWeek),
      benchDistKm: parseFloat(benchDist),
      benchTimeSec: parseTime(benchTime),
      easyPaceSec: easyPace && parseTime(easyPace) > 0 ? parseTime(easyPace) : null,
    });
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
        <h3>Your goal</h3>
        <div className="chips">
          {PRESET.map(([l, km]) => (
            <button key={l} className={`chip ${parseFloat(goalDistanceKm) === km ? "chip-on" : ""}`} onClick={() => setGoalDistanceKm(km)}>{l}</button>
          ))}
        </div>
        <div className="form-grid">
          <label className="field"><span>Distance (km)</span><input type="number" step="0.1" value={goalDistanceKm} onChange={(e) => setGoalDistanceKm(e.target.value)} /></label>
          <label className="field"><span>Goal type</span>
            <select value={goalType} onChange={(e) => setGoalType(e.target.value)}>
              <option value="distance">Just finish the distance</option>
              <option value="time">Target time</option>
            </select>
          </label>
          {goalType === "time" && (
            <label className="field"><span>Target time (h:mm:ss)</span><input value={goalTime} onChange={(e) => setGoalTime(e.target.value)} placeholder="1:45:00" /></label>
          )}
          <label className="field"><span>Race date</span><input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h3>Your current training</h3>
        <div className="form-grid">
          <label className="field"><span>Current weekly km</span><input type="number" value={currentWeeklyKm} onChange={(e) => setCurrentWeeklyKm(e.target.value)} /></label>
          <label className="field"><span>Days/week you'll run</span>
            <select value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value)}>
              {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </div>
        {parseInt(daysPerWeek) === 2 && (
          <p className="muted small">On 2 days a week, both runs count: one long run (easy effort) and one quality session. That's a legit way to train — consistency beats volume.</p>
        )}
      </section>

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

      <button className="btn-primary" onClick={submit} disabled={(!benchTime || parseTime(benchTime) <= 0) && (!easyPace || parseTime(easyPace) <= 0)}>{saved ? "✓ Saved — check the Plan tab" : "Save & generate plan"}</button>
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
function scoreColor(s) { return s >= 8 ? "var(--accent)" : s >= 5 ? "var(--amber)" : "var(--coral)"; }

function currentWeek(profile, plan) {
  if (!plan.length || !profile.raceDate) return plan[0];
  const total = plan.length;
  const wksOut = weeksBetween(new Date().toISOString(), profile.raceDate);
  const idx = Math.min(total - 1, Math.max(0, total - wksOut - 1));
  return plan[idx];
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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ---------- styles ---------- */

function StyleBlock() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap');
      * { box-sizing: border-box; }
      .wrap {
        --bg: #0d0f0e; --panel: #161a18; --panel-2:#1d221f; --line:#2a302c;
        --ink:#eef2ee; --muted:#8b958d; --accent:#caff5e; --accent-dim:#9fcf3f;
        --coral:#ff6b5e; --amber:#ffc24b;
        font-family:'Bricolage Grotesque', sans-serif;
        background: radial-gradient(1200px 600px at 80% -10%, #1a221b 0%, var(--bg) 55%);
        color:var(--ink); min-height:100vh; min-height:100dvh; padding:0 0 calc(60px + env(safe-area-inset-bottom)); max-width:760px; margin:0 auto;
      }
      .mono, .stat-val, .pt-pace, .score-big, .run-meta { font-family:'JetBrains Mono', monospace; }
      .loading { padding:80px 24px; text-align:center; color:var(--muted); font-size:18px; }

      .topbar { display:flex; align-items:baseline; justify-content:space-between; padding:calc(22px + env(safe-area-inset-top)) 22px 8px; }
      .brand { font-weight:800; font-size:26px; letter-spacing:-0.04em; display:flex; align-items:center; gap:9px; }
      .logo { height:34px; width:34px; flex-shrink:0; filter:drop-shadow(0 0 10px rgba(202,255,94,0.25)); }
      .brand-word { line-height:1; }
      .brand-dot { color:var(--accent); }
      .brand-sub { font-weight:400; font-size:12px; color:var(--muted); margin-left:2px; letter-spacing:0.04em; text-transform:uppercase; align-self:flex-end; padding-bottom:3px; }
      .hello { color:var(--muted); font-size:14px; }

      .tabs { display:flex; gap:6px; overflow-x:auto; padding:8px 18px 14px; position:sticky; top:0; z-index:5;
        background:linear-gradient(var(--bg), rgba(13,15,14,0.85)); backdrop-filter:blur(8px); }
      .tabs::-webkit-scrollbar { display:none; }
      .tab { white-space:nowrap; border:1px solid var(--line); background:var(--panel); color:var(--muted);
        padding:8px 14px; border-radius:999px; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:.15s; }
      .tab:hover { color:var(--ink); }
      .tab-active { background:var(--accent); color:#10130d; border-color:var(--accent); }

      .content { padding:6px 18px; }
      .stack { display:flex; flex-direction:column; gap:14px; }

      .card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px; }
      .card h3 { margin:0 0 10px; font-size:16px; font-weight:700; letter-spacing:-0.01em; }
      .card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .card-head h3 { margin:0; }
      .clickable { cursor:pointer; }
      .empty { text-align:center; color:var(--muted); padding:34px 18px; }

      .hero { background:linear-gradient(135deg, var(--panel-2), var(--panel)); }
      .hero-row { display:flex; gap:10px; flex-wrap:wrap; }
      .stat { flex:1; min-width:80px; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px; }
      .stat-val { font-size:22px; font-weight:600; letter-spacing:-0.02em; }
      .stat-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-top:4px; }

      .pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
      .pill-base { background:var(--panel-2); color:var(--muted); border:1px solid var(--line); }
      .pill-accent { background:rgba(202,255,94,0.14); color:var(--accent); border:1px solid rgba(202,255,94,0.3); }
      .pill-hard { background:rgba(255,107,94,0.14); color:var(--coral); border:1px solid rgba(255,107,94,0.3); }
      .pill-warn { background:rgba(255,194,75,0.12); color:var(--amber); border:1px solid rgba(255,194,75,0.3); }

      .sessions { display:flex; flex-direction:column; gap:8px; }
      .session { display:flex; align-items:center; gap:12px; background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px; }
      .session-day { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--accent); width:34px; font-weight:600; }
      .session-body { flex:1; }
      .session-title { font-weight:700; font-size:14px; }
      .session-detail { font-size:12.5px; color:var(--muted); margin-top:3px; line-height:1.45; }

      .warmup-card { border-color:rgba(202,255,94,0.25); }
      .warmup { margin:10px 0 0; padding-left:20px; }
      .warmup li { font-size:13.5px; margin-bottom:7px; line-height:1.45; }
      .muted { color:var(--muted); font-size:13.5px; line-height:1.55; }
      .small { font-size:12px; }

      .btn-primary { background:var(--accent); color:#10130d; border:none; border-radius:12px; padding:14px;
        font-family:inherit; font-weight:700; font-size:15px; cursor:pointer; transition:.15s; }
      .btn-primary:hover { background:#d8ff7a; }
      .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
      .btn-ghost { background:transparent; border:1px solid var(--line); color:var(--ink); border-radius:10px;
        padding:7px 12px; font-family:inherit; font-size:13px; cursor:pointer; font-weight:600; }
      .btn-ghost:hover { border-color:var(--accent-dim); }
      .btn-ghost.wide { width:100%; padding:12px; }
      .btn-primary.slim { padding:10px 16px; font-size:14px; }
      .span-2 { grid-column:1 / -1; }

      .fitness-banner { display:flex; align-items:center; gap:14px; justify-content:space-between;
        background:linear-gradient(135deg, rgba(202,255,94,0.12), var(--panel)); border-color:rgba(202,255,94,0.35); flex-wrap:wrap; }
      .fitness-banner p { margin:4px 0 0; }
      .fitness-banner strong { font-size:15px; }
      .fitness-banner .btn-primary { flex-shrink:0; }

      .warmup-timer { margin-top:12px; background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:18px; text-align:center; }
      .wu-steps { display:flex; gap:6px; justify-content:center; margin-bottom:14px; }
      .wu-dot { width:34px; height:5px; border-radius:999px; background:var(--line); transition:.3s; }
      .wu-dot.on { background:var(--accent); }
      .wu-dot.past { background:var(--accent-dim); }
      .wu-label { font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--accent); font-weight:700; }
      .wu-time { font-family:'JetBrains Mono',monospace; font-size:44px; font-weight:600; letter-spacing:-0.02em; margin:4px 0; }
      .wu-sub { font-size:13px; max-width:340px; margin:0 auto 14px; line-height:1.5; }
      .wu-controls { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
      .wu-done { padding:6px 0; }
      .wu-done .wu-time { font-size:30px; }

      .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--muted); font-weight:600; margin-bottom:10px; }
      .field span { text-transform:uppercase; letter-spacing:0.05em; font-size:11px; }
      input, select, textarea { background:var(--bg); border:1px solid var(--line); color:var(--ink);
        border-radius:10px; padding:11px; font-family:inherit; font-size:14px; width:100%; }
      input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent-dim); }
      textarea { resize:vertical; }

      .pace-readout { margin-top:8px; font-size:14px; }
      .warn { color:var(--amber); font-size:13px; }

      .slider { -webkit-appearance:none; width:100%; height:8px; border-radius:999px;
        background:linear-gradient(90deg,var(--coral),var(--amber),var(--accent)); margin:8px 0 4px; }
      .slider::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px; border-radius:50%;
        background:#fff; border:3px solid var(--bg); cursor:pointer; }
      .slider-ends { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); }
      .score-big { font-size:22px; font-weight:600; }

      .check-row { display:flex; align-items:center; gap:10px; margin-top:14px; font-size:14px; cursor:pointer; }
      .check-row input { width:18px; height:18px; }

      .chips { display:flex; flex-wrap:wrap; gap:8px; }
      .chip { background:var(--bg); border:1px solid var(--line); color:var(--muted); border-radius:999px;
        padding:8px 13px; font-family:inherit; font-size:13px; cursor:pointer; transition:.12s; font-weight:600; }
      .chip:hover { color:var(--ink); }
      .chip-on { background:var(--accent); color:#10130d; border-color:var(--accent); }
      .chip-pain { background:var(--coral); color:#fff; border-color:var(--coral); }

      .row-item { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-top:1px solid var(--line); font-size:14px; }
      .row-item.col { flex-direction:column; align-items:stretch; gap:6px; }
      .row-item:first-of-type { border-top:none; }
      .row-gap { display:flex; gap:8px; align-items:center; }

      .run-item { border-top:1px solid var(--line); padding:13px 0; }
      .run-item:first-of-type { border-top:none; }
      .run-main { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .run-type { font-weight:700; font-size:14px; }
      .run-meta { font-size:12.5px; color:var(--muted); }
      .run-feel { margin-top:5px; font-weight:600; font-size:13px; }
      .pain-tag { color:var(--coral); }
      .run-notes { font-style:italic; color:var(--muted); font-size:13px; margin-top:5px; }
      .run-foot { display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
      .del { background:none; border:none; color:var(--coral); font-size:12px; cursor:pointer; font-family:inherit; opacity:.7; }
      .del:hover { opacity:1; }

      .fuel-head { display:flex; justify-content:space-between; align-items:center; }
      .meal { display:flex; gap:10px; font-size:13.5px; padding:2px 0; }
      .meal span { color:var(--accent); font-weight:700; min-width:18px; font-family:'JetBrains Mono',monospace; font-size:12px; }
      .note-card { background:var(--panel-2); }

      .insight p { font-size:14px; line-height:1.6; margin:0; }
      .bars { display:flex; flex-direction:column; gap:9px; }
      .bar-row { display:flex; align-items:center; gap:10px; }
      .bar-label { font-size:13px; width:130px; flex-shrink:0; }
      .bar-track { flex:1; height:9px; background:var(--bg); border-radius:999px; overflow:hidden; }
      .bar-fill { height:100%; background:var(--accent); border-radius:999px; }
      .bar-n { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--muted); width:20px; text-align:right; }

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
      .effort-chip:hover:not(:disabled) { background:var(--accent); color:#10130d; border-color:var(--accent); }
      .effort-chip:disabled { opacity:.4; cursor:default; }

      @media (max-width:520px){ .form-grid { grid-template-columns:1fr; } .bar-label{width:96px;} }
    `}</style>
  );
}