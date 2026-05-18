import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Tabata",   active: 20,      break: 10,      rounds: 8 },
  { label: "HIIT",     active: 40,      break: 20,      rounds: 6 },
  { label: "Pomodoro", active: 25 * 60, break: 5 * 60,  rounds: 4 },
  { label: "Focus",    active: 45 * 60, break: 15 * 60, rounds: 4 },
];

const C = {
  navy:        "#1B2036",
  navyMid:     "#1E2540",
  navyDeep:    "#161829",
  ivory:       "#F6F4EF",
  coral:       "#E5857B",
  coralDim:    "rgba(229,133,123,0.12)",
  sage:        "#AFC7B0",
  sageDim:     "rgba(175,199,176,0.12)",
  dim:         "rgba(246,244,239,0.45)",
  muted:       "rgba(246,244,239,0.28)",
  faint:       "rgba(246,244,239,0.10)",
  faintest:    "rgba(246,244,239,0.055)",
};

const DEFAULTS = { active: 20, break: 10, rounds: 8, sound: true };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n) { return String(Math.floor(n)).padStart(2, "0"); }
function fmt(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
function fmtVal(v) {
  if (v < 60) return `${v}s`;
  const m = Math.floor(v / 60), s = v % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function loadSettings() {
  try {
    const s = localStorage.getItem("tabata-v1");
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

// ─── Audio ───────────────────────────────────────────────────────────────────

function beep(ctx, type) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.connect(g); g.connect(ctx.destination);
  if (type === "start") {
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.28, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    o.start(); o.stop(ctx.currentTime + 0.22);
  } else if (type === "end") {
    o.frequency.value = 440;
    g.gain.setValueAtTime(0.28, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } else {
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.13, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    o.start(); o.stop(ctx.currentTime + 0.09);
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TabataTimer() {
  const [settings, setSettings]   = useState(loadSettings);
  const [phase, setPhase]         = useState("idle");
  const [timeLeft, setTimeLeft]   = useState(() => loadSettings().active);
  const [round, setRound]         = useState(1);
  const [running, setRunning]     = useState(false);
  const [fs, setFs]               = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft]         = useState(settings);
  const [pulse, setPulse]         = useState(false);

  const ivlRef  = useRef(null);
  const actxRef = useRef(null);
  const wlRef   = useRef(null);
  const rootRef = useRef(null);

  // ── Audio ──
  const audio = useCallback(() => {
    if (!actxRef.current)
      actxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return actxRef.current;
  }, []);

  const play = useCallback((t) => {
    if (!settings.sound) return;
    try { beep(audio(), t); } catch {}
  }, [settings.sound, audio]);

  // ── Persist settings ──
  useEffect(() => {
    localStorage.setItem("tabata-v1", JSON.stringify(settings));
  }, [settings]);

  // ── Wake Lock ──
  const acquireWL = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wlRef.current = await navigator.wakeLock.request("screen");
    } catch {}
  }, []);

  const releaseWL = useCallback(() => {
    if (!wlRef.current) return;
    wlRef.current.release().catch(() => {});
    wlRef.current = null;
  }, []);

  // Re-acquire wake lock after tab becomes visible again (browser auto-releases on hide)
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "visible" && running && !wlRef.current) {
        acquireWL();
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [running, acquireWL]);

  // ── Timer control ──
  const stopTimer = useCallback(() => {
    clearInterval(ivlRef.current);
    setRunning(false);
    releaseWL();
  }, [releaseWL]);

  const reset = useCallback(() => {
    stopTimer();
    setPhase("idle");
    setTimeLeft(settings.active);
    setRound(1);
    setPulse(false);
  }, [stopTimer, settings.active]);

  const tick = useCallback(() => {
    setTimeLeft(p => {
      const next = p <= 1 ? 0 : p - 1;
      if (next <= 3 && next > 0) {
        play("tick");
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      } else {
        setPulse(false);
      }
      return next;
    });
  }, [play]);

  // Phase transitions
  useEffect(() => {
    if (timeLeft !== 0 || !running) return;
    clearInterval(ivlRef.current);
    setPulse(false);
    setPhase(cur => {
      if (cur === "active") {
        play("end");
        setTimeLeft(settings.break);
        ivlRef.current = setInterval(tick, 1000);
        return "break";
      }
      if (cur === "break") {
        setRound(r => {
          if (r >= settings.rounds) {
            stopTimer();
            setPhase("done");
            play("end");
            return r;
          }
          play("start");
          setTimeLeft(settings.active);
          ivlRef.current = setInterval(tick, 1000);
          setPhase("active");
          return r + 1;
        });
      }
      return cur;
    });
  }, [timeLeft, running, settings, tick, stopTimer, play]);

  const start = useCallback(() => {
    play("start");
    setPhase("active");
    setTimeLeft(settings.active);
    setRound(1);
    setRunning(true);
    setPulse(false);
    acquireWL();
    ivlRef.current = setInterval(tick, 1000);
  }, [play, settings.active, tick, acquireWL]);

  const resume = useCallback(() => {
    setRunning(true);
    acquireWL();
    ivlRef.current = setInterval(tick, 1000);
  }, [tick, acquireWL]);

  const pause = useCallback(() => {
    clearInterval(ivlRef.current);
    setRunning(false);
    setPulse(false);
    releaseWL();
  }, [releaseWL]);

  // ── Keyboard ──
  useEffect(() => {
    const h = (e) => {
      if (e.code !== "Space" || modalOpen) return;
      e.preventDefault();
      if (phase === "idle" || phase === "done") start();
      else if (running) pause();
      else resume();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [phase, running, start, pause, resume, modalOpen]);

  // ── Fullscreen ──
  const toggleFs = useCallback(() => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // ── Cleanup ──
  useEffect(() => () => { stopTimer(); releaseWL(); }, []);

  // ── Settings ──
  const applyPreset = (p) => {
    const s = { ...settings, active: p.active, break: p.break, rounds: p.rounds };
    setSettings(s);
    stopTimer();
    setPhase("idle");
    setTimeLeft(p.active);
    setRound(1);
    setPulse(false);
  };

  const saveSettings = () => {
    setSettings(draft);
    clearInterval(ivlRef.current);
    setRunning(false);
    setPhase("idle");
    setTimeLeft(draft.active);
    setRound(1);
    setPulse(false);
    setModalOpen(false);
  };

  // ── Derived values ──
  const phaseColor    = phase === "active" ? C.coral : phase === "break" ? C.sage : C.dim;
  const phaseBg       = phase === "active" ? C.coralDim : phase === "break" ? C.sageDim : "transparent";
  const phaseWord     = phase === "active" ? "Work" : phase === "break" ? "Rest" : phase === "done" ? "Done" : "Ready";
  const totalSecs     = phase === "active" ? settings.active : phase === "break" ? settings.break : 1;
  const progress      = (phase === "idle" || phase === "done") ? 0 : Math.max(0, (totalSecs - timeLeft) / totalSecs);
  const R             = 54;
  const circ          = 2 * Math.PI * R;
  const isActive      = phase !== "idle" && phase !== "done";

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      style={{
        minHeight: "100vh",
        background: fs ? C.navyDeep : C.navy,
        color: C.ivory,
        fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transition: "background 0.6s ease",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.navy}; }

        /* Buttons */
        .btn {
          font-family: 'DM Sans', sans-serif;
          border: none; cursor: pointer;
          transition: transform 0.1s ease, opacity 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .btn:active { transform: scale(0.955); opacity: 0.85; }

        /* Phase background wash — fills full viewport height smoothly */
        .phase-wash {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          transition: background 0.7s ease;
        }

        /* Digits pulse on last 3 seconds */
        @keyframes subtlePulse {
          0%   { opacity: 1; }
          40%  { opacity: 0.55; }
          100% { opacity: 1; }
        }
        .digits-pulse {
          animation: subtlePulse 0.6s ease-in-out;
        }

        /* Arc progress */
        .arc-progress { transition: stroke-dashoffset 0.85s linear; }

        /* Phase color transition on label */
        .phase-label { transition: color 0.5s ease; }

        /* Preset pills */
        .preset-pill {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 500; letter-spacing: .06em;
          padding: 8px 16px; border-radius: 100px; cursor: pointer;
          border: 1px solid ${C.faint}; background: ${C.faintest}; color: ${C.dim};
          transition: background .15s, color .15s, border-color .15s;
          white-space: nowrap; -webkit-tap-highlight-color: transparent;
        }
        .preset-pill:hover { background: rgba(246,244,239,0.1); color: ${C.ivory}; border-color: rgba(246,244,239,0.25); }

        /* Range slider */
        input[type=range] {
          -webkit-appearance: none; width: 100%; height: 3px;
          border-radius: 2px; background: rgba(246,244,239,0.12); outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 20px; height: 20px;
          border-radius: 50%; background: ${C.ivory}; cursor: pointer;
        }

        /* Toggle */
        .toggle {
          width: 42px; height: 24px; border-radius: 12px;
          border: none; cursor: pointer; position: relative;
          transition: background .25s ease; flex-shrink: 0;
        }
        .toggle-dot {
          position: absolute; top: 4px;
          width: 16px; height: 16px; border-radius: 50%;
          background: #fff; transition: left .22s ease;
        }

        /* SEO section */
        .seo h1 { font-size: 20px; font-weight: 500; color: rgba(246,244,239,0.65); margin-bottom: 12px; line-height: 1.4; }
        .seo h2 { font-size: 11px; font-weight: 600; color: rgba(246,244,239,0.35); margin: 36px 0 10px; letter-spacing: .12em; text-transform: uppercase; }
        .seo p  { font-size: 14px; line-height: 1.85; color: rgba(246,244,239,0.35); }
        .seo ul { font-size: 14px; line-height: 1.85; color: rgba(246,244,239,0.35); padding-left: 0; list-style: none; }
        .seo li { margin-bottom: 8px; padding-left: 16px; position: relative; }
        .seo li::before { content: "–"; position: absolute; left: 0; color: rgba(246,244,239,0.2); }
        .seo strong { color: rgba(246,244,239,0.52); font-weight: 500; }

        /* Mobile landscape compact mode */
        @media (max-height: 500px) and (orientation: landscape) {
          .phase-top-margin { margin-top: 16px !important; }
          .phase-label-size { font-size: 24px !important; }
          .digits-size      { font-size: 72px !important; letter-spacing: -3px !important; }
          .round-row        { margin-bottom: 16px !important; }
          .controls-gap     { gap: 8px !important; }
          .primary-btn      { padding: 14px 0 !important; }
          .secondary-btn    { padding: 10px 0 !important; }
          .stats-strip      { margin-top: 16px !important; }
          .presets-row      { margin-top: 12px !important; }
        }

        /* Small portrait phones */
        @media (max-width: 390px) {
          .digits-size { font-size: 92px !important; letter-spacing: -4px !important; }
          .controls-max { max-width: 280px !important; }
        }

        /* Fullscreen-specific overrides */
        .fs-digits { font-size: clamp(140px, 34vw, 220px) !important; letter-spacing: -8px !important; }
        .fs-phase  { font-size: clamp(44px, 10vw, 64px) !important; }
        .fs-top-margin { margin-top: 0 !important; }
      `}</style>

      {/* Phase background wash — very subtle tint that fills the whole page */}
      <div
        className="phase-wash"
        style={{ background: isActive ? phaseBg : "transparent" }}
      />

      {/* ── Everything sits above the wash ── */}
      <div style={{ position: "relative", zIndex: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* ── Top bar — hidden in fullscreen ── */}
        {!fs && (
          <div style={{
            width: "100%", maxWidth: 480,
            padding: "16px 24px 0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".12em", color: C.muted, textTransform: "uppercase" }}>
              Tabata Timer
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={toggleFs} className="btn" aria-label="Enter fullscreen"
                style={{ background: C.faintest, border: `1px solid ${C.faint}`, color: C.muted, borderRadius: 9, padding: "7px 11px", fontSize: 15, lineHeight: 1 }}
              >⛶</button>
              <button
                onClick={() => { setDraft(settings); setModalOpen(true); }} className="btn" aria-label="Settings"
                style={{ background: C.faintest, border: `1px solid ${C.faint}`, color: C.muted, borderRadius: 9, padding: "7px 13px", fontSize: 15, lineHeight: 1 }}
              >⚙</button>
            </div>
          </div>
        )}

        {/* ── Hero timer block ── */}
        <div style={{
          width: "100%",
          maxWidth: fs ? "100%" : 480,
          padding: fs ? "0 32px" : "0 24px",
          display: "flex", flexDirection: "column", alignItems: "center",
          // In fullscreen: vertically center in the viewport
          ...(fs ? {
            minHeight: "100vh",
            justifyContent: "center",
          } : {}),
        }}>

          {/* Phase label */}
          <div className={`phase-top-margin ${fs ? "fs-top-margin" : ""}`} style={{ marginTop: fs ? 0 : 48, marginBottom: 0, textAlign: "center" }}>
            <span
              className={`phase-label phase-label-size ${fs ? "fs-phase" : ""}`}
              style={{
                display: "block",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "clamp(36px, 9vw, 52px)",
                fontWeight: 400,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: phaseColor,
                lineHeight: 1,
              }}
            >
              {phaseWord}
            </span>
          </div>

          {/* Digits */}
          <div
            className={`digits-size ${pulse ? "digits-pulse" : ""} ${fs ? "fs-digits" : ""}`}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "clamp(104px, 28vw, 160px)",
              fontWeight: 400,
              letterSpacing: "-6px",
              color: C.ivory,
              lineHeight: 0.9,
              userSelect: "none",
              margin: "8px 0 20px",
            }}
          >
            {fmt(timeLeft)}
          </div>

          {/* Round row */}
          <div className="round-row" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: fs ? 48 : 40 }}>
            <svg width="22" height="22" viewBox="0 0 120 120" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="60" cy="60" r={R} fill="none" stroke={C.faintest} strokeWidth="14" />
              <circle
                cx="60" cy="60" r={R} fill="none"
                stroke={phaseColor} strokeWidth="14" strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - progress)}
                transform="rotate(-90 60 60)"
                className="arc-progress"
                opacity=".85"
              />
            </svg>
            <span style={{ fontSize: fs ? 16 : 13, color: C.dim, letterSpacing: ".03em" }}>
              Round{" "}
              <span style={{ color: C.ivory, fontWeight: 500 }}>
                {phase === "done" ? settings.rounds : round}
              </span>
              <span style={{ color: C.muted }}> / {settings.rounds}</span>
            </span>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              {Array.from({ length: Math.min(settings.rounds, 12) }).map((_, i) => (
                <span key={i} style={{
                  display: "inline-block",
                  width: fs ? 8 : 6, height: fs ? 8 : 6,
                  borderRadius: "50%",
                  background:
                    i < round - 1 ? C.coral :
                    i === round - 1 && isActive ? phaseColor :
                    C.faint,
                  transition: "background .35s",
                }} />
              ))}
            </div>
          </div>

          {/* Controls */}
          <div
            className="controls-max"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 12, width: "100%",
              maxWidth: fs ? 380 : 320,
            }}
          >
            {/* Primary action */}
            {(phase === "idle" || phase === "done") && (
              <button onClick={start} className="btn primary-btn" style={{
                width: "100%", padding: "22px 0", borderRadius: 16,
                background: C.coral, color: "#fff",
                fontSize: 16, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase",
                boxShadow: `0 8px 32px ${C.coral}40`,
              }}>
                {phase === "done" ? "Again" : "Start"}
              </button>
            )}
            {isActive && running && (
              <button onClick={pause} className="btn primary-btn" style={{
                width: "100%", padding: "22px 0", borderRadius: 16,
                background: "rgba(246,244,239,0.08)", color: C.ivory,
                fontSize: 16, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase",
                border: `1px solid rgba(246,244,239,0.18)`,
              }}>
                Pause
              </button>
            )}
            {isActive && !running && (
              <button onClick={resume} className="btn primary-btn" style={{
                width: "100%", padding: "22px 0", borderRadius: 16,
                background: C.sage, color: "#fff",
                fontSize: 16, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase",
                boxShadow: `0 8px 32px ${C.sage}40`,
              }}>
                Resume
              </button>
            )}

            {/* Secondary row — always visible */}
            <div className="controls-gap" style={{ display: "flex", gap: 10, width: "100%" }}>
              <button onClick={reset} className="btn secondary-btn" style={{
                flex: 1, padding: "14px 0", borderRadius: 12,
                background: C.faintest, border: `1px solid ${C.faint}`,
                color: C.dim, fontSize: 13, fontWeight: 500, letterSpacing: ".05em",
              }}>
                ↺ Restart
              </button>
              <button
                onClick={() => setSettings(s => ({ ...s, sound: !s.sound }))}
                className="btn secondary-btn"
                aria-label={settings.sound ? "Mute" : "Unmute"}
                style={{
                  padding: "14px 18px", borderRadius: 12,
                  background: C.faintest, border: `1px solid ${C.faint}`,
                  color: settings.sound ? C.ivory : C.muted, fontSize: 17, lineHeight: 1,
                }}
              >
                {settings.sound ? "♪" : "♩"}
              </button>
              {/* Fullscreen exit button — only shown in fullscreen mode */}
              {fs && (
                <button onClick={toggleFs} className="btn secondary-btn" aria-label="Exit fullscreen" style={{
                  padding: "14px 16px", borderRadius: 12,
                  background: C.faintest, border: `1px solid ${C.faint}`,
                  color: C.muted, fontSize: 15, lineHeight: 1,
                }}>
                  ⊡
                </button>
              )}
            </div>
          </div>

          {/* Stats strip + presets — hidden in fullscreen */}
          {!fs && (
            <>
              <div className="stats-strip" style={{
                display: "flex", marginTop: 36, marginBottom: 4,
                border: `1px solid ${C.faint}`, borderRadius: 13, overflow: "hidden",
              }}>
                {[
                  { label: "Work",   val: fmtVal(settings.active), color: C.coral },
                  { label: "Rest",   val: fmtVal(settings.break),  color: C.sage  },
                  { label: "Rounds", val: settings.rounds,          color: C.dim   },
                ].map((item, i) => (
                  <div key={item.label} style={{
                    padding: "11px 22px", textAlign: "center",
                    background: C.faintest,
                    borderLeft: i > 0 ? `1px solid ${C.faint}` : "none",
                  }}>
                    <div style={{ color: item.color, fontWeight: 500, fontSize: 15, lineHeight: 1 }}>{item.val}</div>
                    <div style={{ color: C.muted, fontSize: 10, marginTop: 4, textTransform: "uppercase", letterSpacing: ".09em" }}>{item.label}</div>
                  </div>
                ))}
              </div>

              <div className="presets-row" style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center", marginTop: 20, marginBottom: 10 }}>
                {PRESETS.map(p => (
                  <button key={p.label} className="preset-pill" onClick={() => applyPreset(p)}>{p.label}</button>
                ))}
              </div>

              <p style={{ fontSize: 10, color: "rgba(246,244,239,0.14)", letterSpacing: ".1em", textTransform: "uppercase", margin: "10px 0 64px" }}>
                Spacebar — start / pause / resume
              </p>
            </>
          )}

          {/* Fullscreen keyboard hint */}
          {fs && (
            <p style={{ fontSize: 11, color: "rgba(246,244,239,0.18)", letterSpacing: ".1em", textTransform: "uppercase", marginTop: 32 }}>
              Spacebar — start / pause / resume
            </p>
          )}

        </div>

        {/* ── Settings bottom sheet ── */}
        {modalOpen && (
          <div
            onClick={() => setModalOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
              display: "flex", alignItems: "flex-end", justifyContent: "center",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: C.navyMid, borderRadius: "20px 20px 0 0",
                border: `1px solid ${C.faint}`,
                padding: "28px 26px 48px", width: "100%", maxWidth: 520,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: ".04em" }}>Timer Settings</span>
                <button
                  onClick={() => setModalOpen(false)}
                  style={{ background: "none", border: "none", color: C.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}
                >×</button>
              </div>

              {[
                { key: "active", label: "Work Duration", suffix: "sec", min: 5,  max: 5400 },
                { key: "break",  label: "Rest Duration", suffix: "sec", min: 5,  max: 3600 },
                { key: "rounds", label: "Rounds",         suffix: "",    min: 1,  max: 20   },
              ].map(({ key, label, suffix, min, max }) => (
                <div key={key} style={{ marginBottom: 26 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <label style={{ fontSize: 13, color: C.dim }}>{label}</label>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {key === "rounds" ? draft[key] : fmtVal(draft[key])}
                    </span>
                  </div>
                  <input
                    type="range" min={min} max={max}
                    step={key === "rounds" ? 1 : 5}
                    value={draft[key]}
                    onChange={e => setDraft(s => ({ ...s, [key]: Number(e.target.value) }))}
                  />
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, marginTop: 4 }}>
                <span style={{ fontSize: 13, color: C.dim }}>Sound Effects</span>
                <button
                  onClick={() => setDraft(s => ({ ...s, sound: !s.sound }))}
                  className="toggle" aria-pressed={draft.sound}
                  style={{ background: draft.sound ? C.sage : "rgba(246,244,239,0.14)" }}
                >
                  <div className="toggle-dot" style={{ left: draft.sound ? "22px" : "4px" }} />
                </button>
              </div>

              <button onClick={saveSettings} className="btn" style={{
                width: "100%", padding: "17px 0", borderRadius: 14,
                background: C.coral, color: "#fff",
                fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
              }}>
                Apply Settings
              </button>
            </div>
          </div>
        )}

        {/* ── SEO content — hidden in fullscreen ── */}
        {!fs && (
          <div style={{
            width: "100%", maxWidth: 500,
            borderTop: `1px solid ${C.faintest}`,
            padding: "80px 32px 112px",
          }}>
            <section className="seo">
              <h1>Free Online Tabata Timer</h1>
              <p>
                A clean, distraction-free interval timer for workouts, study sessions, focus sprints, and more.
                No ads, no signup — just your intervals.
              </p>

              <h2>What is Tabata?</h2>
              <p>
                Tabata is a high-intensity interval training protocol developed by Dr. Izumi Tabata.
                The classic format: 20 seconds of maximum effort, 10 seconds of rest, repeated 8 rounds.
                Research shows it significantly improves both aerobic and anaerobic capacity in just 4 minutes.
              </p>

              <h2>How to Use This Timer</h2>
              <ul>
                <li>Pick a preset or tap ⚙ to set custom work, rest, and round values.</li>
                <li>Press Start — or hit Spacebar — and follow the phase color: coral for work, sage for rest.</li>
                <li>Sound cues fire in the final 3 seconds of each phase. Settings save automatically.</li>
              </ul>

              <h2>Use Cases</h2>
              <ul>
                <li><strong>Workouts —</strong> sprints, kettlebell circuits, bodyweight HIIT, mobility holds.</li>
                <li><strong>Studying —</strong> active recall sprints with short breaks to consolidate memory.</li>
                <li><strong>Focus sessions —</strong> deep work blocks with structured rest, lighter than Pomodoro.</li>
                <li><strong>Decluttering —</strong> timed effort bursts to stay in motion without burning out.</li>
              </ul>

              <h2>Tips</h2>
              <p>
                Fullscreen mode makes digits readable from across the room. Wake Lock keeps your screen on during workouts.
                Use Spacebar to start, pause, and resume hands-free.
              </p>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}