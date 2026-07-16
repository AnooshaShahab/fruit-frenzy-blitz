import { useEffect, useRef, useState, useCallback } from "react";

type Screen = "loading" | "menu" | "modes" | "game" | "gameover" | "leaderboard" | "settings" | "paused";
type Mode = "classic" | "arcade" | "zen";

interface Fruit {
  x: number; y: number; vx: number; vy: number;
  radius: number; rotation: number; vr: number;
  type: string; color: string; color2: string;
  sliced: boolean; isBomb?: boolean; bombType?: "classic" | "ice" | "golden";
  isPowerup?: boolean; powerType?: string;
  golden?: boolean; rainbow?: boolean;
  half?: "left" | "right"; life?: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  radius: number; color: string; life: number; maxLife: number;
}

interface ScorePop { x: number; y: number; text: string; life: number; color: string; size: number; }
interface ComboPop { text: string; life: number; }
interface TrailPoint { x: number; y: number; t: number; }
interface Score { score: number; combo: number; coins: number; date: string; }

const FRUITS = [
  { type: "watermelon", color: "#ff3b5c", color2: "#2ecc71", radius: 55 },
  { type: "orange", color: "#ff8c1a", color2: "#ffb347", radius: 42 },
  { type: "apple", color: "#e74c3c", color2: "#f9e4b7", radius: 44 },
  { type: "banana", color: "#ffd93d", color2: "#fff2a8", radius: 46 },
  { type: "pineapple", color: "#f5c518", color2: "#a1cc3a", radius: 48 },
  { type: "kiwi", color: "#8bc34a", color2: "#dcedc8", radius: 40 },
  { type: "grape", color: "#8e44ad", color2: "#c39bd3", radius: 40 },
  { type: "lemon", color: "#f4d03f", color2: "#fef9c3", radius: 40 },
  { type: "cherry", color: "#c0392b", color2: "#f1948a", radius: 36 },
  { type: "dragon", color: "#ff2e93", color2: "#fff", radius: 46 },
  { type: "coconut", color: "#7b4b2a", color2: "#fff5e1", radius: 44 },
];

const POWERUPS = ["freeze", "double", "rainbow", "shield", "magnet"];

// ---------- Audio ----------
class Sfx {
  ctx: AudioContext | null = null;
  enabled = true;
  ensure() {
    if (!this.ctx && typeof window !== "undefined") {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (AC) this.ctx = new AC();
    }
  }
  play(freq: number, dur = 0.1, type: OscillatorType = "sine", vol = 0.15) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }
  slice() { this.play(600 + Math.random() * 300, 0.08, "triangle", 0.12); }
  combo() { this.play(880, 0.12, "square", 0.1); setTimeout(() => this.play(1100, 0.12, "square", 0.1), 80); }
  bomb() { this.play(80, 0.4, "sawtooth", 0.3); }
  coin() { this.play(1200, 0.06, "sine", 0.12); setTimeout(() => this.play(1600, 0.08, "sine", 0.12), 50); }
  click() { this.play(500, 0.05, "square", 0.08); }
  gameover() { [400, 300, 200].forEach((f, i) => setTimeout(() => this.play(f, 0.3, "sawtooth", 0.15), i * 150)); }
}
const sfx = new Sfx();

// ---------- Component ----------
export default function FruitSlashFrenzy() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [mode, setMode] = useState<Mode>("classic");
  const [loadPct, setLoadPct] = useState(0);
  const [hud, setHud] = useState({ score: 0, lives: 3, combo: 0, coins: 0, time: 90, best: 0 });
  const [settings, setSettings] = useState({ music: true, sound: true, quality: "high" as "high" | "medium" | "low" });
  const [gameOverStats, setGameOverStats] = useState<Score | null>(null);

  const stateRef = useRef({
    fruits: [] as Fruit[],
    particles: [] as Particle[],
    scorePops: [] as ScorePop[],
    comboPop: null as ComboPop | null,
    trail: [] as TrailPoint[],
    score: 0, lives: 3, coins: 0, combo: 0, maxCombo: 0,
    time: 90, elapsed: 0, spawnTimer: 0, spawnInterval: 900,
    difficulty: 1, freezeUntil: 0, doubleUntil: 0, rainbowUntil: 0,
    shield: false, magnetUntil: 0, shake: 0, slowMoUntil: 0,
    running: false, mode: "classic" as Mode,
    lastFrame: 0, w: 0, h: 0,
    menuFruits: [] as Fruit[],
    isDown: false, lastX: 0, lastY: 0,
  });

  // ---------- Loading ----------
  useEffect(() => {
    if (screen !== "loading") return;
    let p = 0;
    const iv = setInterval(() => {
      p += 3 + Math.random() * 6;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setScreen("menu"), 400); }
      setLoadPct(Math.floor(p));
    }, 80);
    return () => clearInterval(iv);
  }, [screen]);

  // ---------- Best score ----------
  useEffect(() => {
    try {
      const b = parseInt(localStorage.getItem("fsf_best") || "0", 10);
      const c = parseInt(localStorage.getItem("fsf_coins") || "0", 10);
      setHud(h => ({ ...h, best: b, coins: c }));
    } catch { /* ignore */ }
    try {
      const s = JSON.parse(localStorage.getItem("fsf_settings") || "null");
      if (s) { setSettings(s); sfx.enabled = s.sound; }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("fsf_settings", JSON.stringify(settings)); } catch { /* ignore */ }
    sfx.enabled = settings.sound;
  }, [settings]);

  // ---------- Helpers ----------
  const spawnFruit = useCallback(() => {
    const s = stateRef.current;
    const w = s.w, h = s.h;
    const roll = Math.random();
    const isBomb = s.mode !== "zen" && roll < 0.09 + s.difficulty * 0.015;
    const isPower = !isBomb && roll > 0.94;
    const golden = !isBomb && !isPower && roll > 0.86;
    const rainbow = !isBomb && !isPower && !golden && roll > 0.82;
    const base = FRUITS[Math.floor(Math.random() * FRUITS.length)];
    const x = 80 + Math.random() * (w - 160);
    const targetX = x + (Math.random() - 0.5) * 300;
    const vy = -(14 + Math.random() * 4 + s.difficulty * 0.6);
    const vx = (targetX - x) / 60;
    const f: Fruit = {
      x, y: h + 40, vx, vy,
      radius: base.radius,
      rotation: 0, vr: (Math.random() - 0.5) * 0.15,
      type: base.type, color: base.color, color2: base.color2, sliced: false,
      golden, rainbow,
    };
    if (isBomb) {
      const bt = Math.random(); f.isBomb = true;
      f.bombType = bt < 0.15 ? "ice" : bt < 0.25 ? "golden" : "classic";
      f.radius = 40; f.color = f.bombType === "ice" ? "#4fc3f7" : f.bombType === "golden" ? "#ffca28" : "#222";
    }
    if (isPower) {
      f.isPowerup = true;
      f.powerType = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      f.color = "#00e5ff"; f.radius = 38;
    }
    s.fruits.push(f);
  }, []);

  const spawnParticles = (x: number, y: number, color: string, count = 18) => {
    const s = stateRef.current;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      s.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        radius: 3 + Math.random() * 5, color, life: 40, maxLife: 40,
      });
    }
  };

  const sliceFruit = (f: Fruit) => {
    const s = stateRef.current;
    if (f.sliced) return;
    f.sliced = true;

    if (f.isBomb) {
      if (f.bombType === "classic") {
        if (s.shield) { s.shield = false; s.shake = 15; spawnParticles(f.x, f.y, "#fff", 30); sfx.bomb(); return; }
        spawnParticles(f.x, f.y, "#ff4500", 60);
        s.shake = 30; sfx.bomb();
        setTimeout(() => endGame(), 500);
        return;
      }
      if (f.bombType === "ice") {
        s.freezeUntil = performance.now() + 3000;
        spawnParticles(f.x, f.y, "#b3e5fc", 40); sfx.combo();
        return;
      }
      if (f.bombType === "golden") {
        s.coins += 20; spawnParticles(f.x, f.y, "#ffd54f", 30); sfx.coin();
        s.scorePops.push({ x: f.x, y: f.y, text: "+20", life: 60, color: "#ffd54f", size: 24 });
        return;
      }
    }

    if (f.isPowerup) {
      const now = performance.now();
      if (f.powerType === "freeze") s.freezeUntil = now + 5000;
      if (f.powerType === "double") s.doubleUntil = now + 10000;
      if (f.powerType === "rainbow") s.rainbowUntil = now + 8000;
      if (f.powerType === "shield") s.shield = true;
      if (f.powerType === "magnet") s.magnetUntil = now + 8000;
      spawnParticles(f.x, f.y, "#00e5ff", 30); sfx.combo();
      s.scorePops.push({ x: f.x, y: f.y, text: (f.powerType || "").toUpperCase() + "!", life: 70, color: "#00e5ff", size: 22 });
      return;
    }

    let pts = f.rainbow ? 50 : f.golden ? 25 : 10;
    if (performance.now() < s.doubleUntil) pts *= 2;
    s.score += pts;
    s.combo += 1;
    if (s.combo > s.maxCombo) s.maxCombo = s.combo;

    if (f.golden) s.coins += 2;
    else if (f.rainbow) s.coins += 5;

    spawnParticles(f.x, f.y, f.color, 20);
    spawnParticles(f.x, f.y, f.color2, 10);
    s.scorePops.push({ x: f.x, y: f.y, text: "+" + pts, life: 50, color: f.rainbow ? "#ff2e93" : f.golden ? "#ffd54f" : "#fff", size: 20 });
    sfx.slice();

    // spawn halves
    for (const half of ["left", "right"] as const) {
      s.fruits.push({
        ...f, sliced: true, half, life: 60,
        vx: f.vx + (half === "left" ? -3 : 3),
        vy: f.vy * 0.5 - 2, vr: (half === "left" ? -0.2 : 0.2),
      });
    }

    // combo popups
    if (s.combo === 3) { s.comboPop = { text: "EXCELLENT! +50", life: 60 }; s.score += 50; sfx.combo(); }
    else if (s.combo === 5) { s.comboPop = { text: "AMAZING! +100", life: 60 }; s.score += 100; sfx.combo(); }
    else if (s.combo === 8) { s.comboPop = { text: "MEGA SLICE!", life: 70 }; s.score += 200; sfx.combo(); }
    else if (s.combo === 12) { s.comboPop = { text: "FRUIT MASTER!", life: 80 }; s.score += 500; sfx.combo(); }
  };

  const endGame = () => {
    const s = stateRef.current;
    s.running = false;
    sfx.gameover();
    const stats: Score = { score: s.score, combo: s.maxCombo, coins: s.coins, date: new Date().toLocaleDateString() };
    setGameOverStats(stats);
    try {
      const best = parseInt(localStorage.getItem("fsf_best") || "0", 10);
      if (s.score > best) localStorage.setItem("fsf_best", String(s.score));
      const totalCoins = parseInt(localStorage.getItem("fsf_coins") || "0", 10) + s.coins;
      localStorage.setItem("fsf_coins", String(totalCoins));
      const board: Score[] = JSON.parse(localStorage.getItem("fsf_board") || "[]");
      board.push(stats);
      board.sort((a, b) => b.score - a.score);
      localStorage.setItem("fsf_board", JSON.stringify(board.slice(0, 10)));
      setHud(h => ({ ...h, best: Math.max(best, s.score), coins: totalCoins }));
    } catch { /* ignore */ }
    setScreen("gameover");
  };

  const startGame = (m: Mode) => {
    const s = stateRef.current;
    s.mode = m;
    s.fruits = []; s.particles = []; s.scorePops = []; s.trail = [];
    s.score = 0; s.lives = 3; s.coins = 0; s.combo = 0; s.maxCombo = 0;
    s.time = 90; s.elapsed = 0; s.spawnTimer = 0; s.spawnInterval = 900;
    s.difficulty = 1; s.freezeUntil = 0; s.doubleUntil = 0; s.rainbowUntil = 0;
    s.shield = false; s.magnetUntil = 0; s.shake = 0;
    s.running = true; s.lastFrame = performance.now();
    setMode(m); setScreen("game"); sfx.click();
  };

  // ---------- Game loop ----------
  useEffect(() => {
    if (screen !== "game") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const s = stateRef.current;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.w = canvas.clientWidth; s.h = canvas.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (!s.running) return;
      const now = performance.now();
      const dt = Math.min(50, now - s.lastFrame);
      s.lastFrame = now;
      const frozen = now < s.freezeUntil;
      const factor = frozen ? 0 : (now < s.slowMoUntil ? 0.3 : 1);

      s.elapsed += dt;
      if (s.mode === "arcade") {
        s.time = Math.max(0, 90 - s.elapsed / 1000);
        if (s.time <= 0) { endGame(); return; }
      }

      // difficulty
      s.difficulty = 1 + Math.floor(s.elapsed / 30000);
      s.spawnInterval = Math.max(300, 900 - s.difficulty * 80);

      // spawn
      s.spawnTimer += dt;
      if (!frozen && s.spawnTimer > s.spawnInterval) {
        s.spawnTimer = 0;
        const n = 1 + Math.floor(Math.random() * (1 + s.difficulty / 2));
        for (let i = 0; i < n; i++) spawnFruit();
      }

      // update fruits
      const grav = 0.5 * factor;
      for (const f of s.fruits) {
        f.vy += grav; f.x += f.vx * factor; f.y += f.vy * factor; f.rotation += f.vr * factor;
        if (f.life !== undefined) f.life -= dt * 0.06;
      }

      // magnet: attract coins? we don't have coins entities; ignore

      // remove offscreen; unsliced non-bomb missed => lose life (classic)
      s.fruits = s.fruits.filter(f => {
        if (f.y > s.h + 100) {
          if (!f.sliced && !f.isBomb && !f.isPowerup && s.mode !== "zen") {
            s.lives -= 1; s.combo = 0;
            if (s.lives <= 0) { endGame(); }
          }
          if (!f.sliced && !f.isBomb) s.combo = 0;
          return false;
        }
        if (f.life !== undefined && f.life <= 0) return false;
        return true;
      });

      // particles
      for (const p of s.particles) {
        p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= 1;
      }
      s.particles = s.particles.filter(p => p.life > 0);

      // pops
      for (const p of s.scorePops) { p.y -= 1; p.life -= 1; }
      s.scorePops = s.scorePops.filter(p => p.life > 0);
      if (s.comboPop) { s.comboPop.life -= 1; if (s.comboPop.life <= 0) s.comboPop = null; }

      // trail
      s.trail = s.trail.filter(t => now - t.t < 200);

      // shake
      if (s.shake > 0) s.shake -= 1;

      // render
      const shakeX = s.shake > 0 ? (Math.random() - 0.5) * s.shake : 0;
      const shakeY = s.shake > 0 ? (Math.random() - 0.5) * s.shake : 0;

      // background: dark charcoal with tropical radial glow
      ctx.fillStyle = "#111111";
      ctx.fillRect(0, 0, s.w, s.h);
      const rg = ctx.createRadialGradient(s.w / 2, s.h * 0.35, 40, s.w / 2, s.h * 0.35, Math.max(s.w, s.h));
      rg.addColorStop(0, "rgba(255,138,0,0.35)");
      rg.addColorStop(0.35, "rgba(56,189,248,0.15)");
      rg.addColorStop(1, "rgba(17,17,17,0)");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, s.w, s.h);

      // subtle vignette
      ctx.save(); ctx.translate(shakeX, shakeY);

      // fruits
      for (const f of s.fruits) drawFruit(ctx, f);

      // particles
      for (const p of s.particles) {
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // trail
      if (s.trail.length > 1) {
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        const rainbow = now < s.rainbowUntil;
        for (let i = 1; i < s.trail.length; i++) {
          const a = s.trail[i - 1], b = s.trail[i];
          const alpha = i / s.trail.length;
          ctx.strokeStyle = rainbow
            ? `hsla(${(i * 30 + now / 5) % 360}, 100%, 60%, ${alpha})`
            : `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = 8 * alpha + 2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }

      // score pops
      for (const p of s.scorePops) {
        ctx.globalAlpha = Math.min(1, p.life / 30);
        ctx.fillStyle = p.color; ctx.font = `bold ${p.size}px system-ui`;
        ctx.textAlign = "center"; ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;

      // combo pop
      if (s.comboPop) {
        const scale = 1 + Math.sin((60 - s.comboPop.life) / 10) * 0.12;
        ctx.save();
        ctx.translate(s.w / 2, s.h / 3);
        ctx.scale(scale, scale);
        ctx.font = '52px "Bungee", "Luckiest Guy", system-ui';
        ctx.textAlign = "center";
        ctx.strokeStyle = "#111111"; ctx.lineWidth = 8;
        ctx.strokeText(s.comboPop.text, 0, 0);
        const cg = ctx.createLinearGradient(0, -30, 0, 30);
        cg.addColorStop(0, "#FFD93D"); cg.addColorStop(1, "#FF8A00");
        ctx.fillStyle = cg; ctx.fillText(s.comboPop.text, 0, 0);
        ctx.restore();
      }

      // freeze overlay
      if (frozen) { ctx.fillStyle = "rgba(179,229,252,0.25)"; ctx.fillRect(0, 0, s.w, s.h); }

      ctx.restore();

      // HUD sync
      setHud(h => ({ ...h, score: s.score, lives: s.lives, combo: s.combo, coins: s.coins, time: Math.ceil(s.time) }));
    };
    raf = requestAnimationFrame(step);

    // input
    const getPos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      s.isDown = true; const p = getPos(e); s.lastX = p.x; s.lastY = p.y;
      s.trail.push({ x: p.x, y: p.y, t: performance.now() });
    };
    const onMove = (e: PointerEvent) => {
      if (!s.isDown) return;
      const p = getPos(e);
      s.trail.push({ x: p.x, y: p.y, t: performance.now() });
      // slice check
      for (const f of s.fruits) {
        if (f.sliced) continue;
        const dx = f.x - p.x, dy = f.y - p.y;
        if (dx * dx + dy * dy < f.radius * f.radius) sliceFruit(f);
      }
      s.lastX = p.x; s.lastY = p.y;
    };
    const onUp = () => { s.isDown = false; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // ---------- Draw fruit ----------
  const drawFruit = (ctx: CanvasRenderingContext2D, f: Fruit) => {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rotation);
    if (f.isBomb) {
      // bomb
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(0, 0, f.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -f.radius); ctx.lineTo(6, -f.radius - 12); ctx.stroke();
      ctx.fillStyle = "#ff5722";
      ctx.beginPath(); ctx.arc(6, -f.radius - 14, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-f.radius / 3, -f.radius / 3, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); return;
    }
    if (f.isPowerup) {
      const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, f.radius);
      grad.addColorStop(0, "#fff"); grad.addColorStop(1, f.color);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, f.radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 20px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("", 0, 2);
      ctx.restore(); return;
    }
    // fruit body
    const drawHalf = (side: "left" | "right" | null) => {
      ctx.beginPath();
      if (side === "left") ctx.arc(0, 0, f.radius, Math.PI / 2, -Math.PI / 2);
      else if (side === "right") ctx.arc(0, 0, f.radius, -Math.PI / 2, Math.PI / 2);
      else ctx.arc(0, 0, f.radius, 0, Math.PI * 2);
      ctx.closePath();
    };
    const color = f.rainbow ? `hsl(${(performance.now() / 5) % 360},90%,55%)` : f.color;
    ctx.fillStyle = color;
    drawHalf(f.half ?? null); ctx.fill();
    if (f.golden) { ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 4; ctx.stroke(); }
    // inner flesh
    ctx.fillStyle = f.color2;
    ctx.beginPath(); ctx.arc(0, 0, f.radius * 0.7, 0, Math.PI * 2); ctx.fill();
    // seeds/highlight
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath(); ctx.ellipse(-f.radius / 3, -f.radius / 3, f.radius / 4, f.radius / 6, -0.5, 0, Math.PI * 2); ctx.fill();
    // leaf
    ctx.fillStyle = "#2ecc71";
    ctx.beginPath(); ctx.ellipse(-4, -f.radius, 8, 12, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  // ---------- Screens ----------
  const bg = "bg-[#111111] bg-[radial-gradient(ellipse_at_top,rgba(255,138,0,0.25),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(56,189,248,0.18),transparent_55%)]";
  const ui = "font-[family-name:var(--font-ui)]";
  const btn = "px-8 py-4 rounded-2xl font-bold text-xl tracking-wide border-2 border-[#FFD93D]/80 shadow-[0_8px_0_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 hover:shadow-[0_10px_0_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.4)] active:translate-y-1 active:shadow-[0_3px_0_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.25)] transition-all";

  const Logo = ({ size = "big" }: { size?: "big" | "small" }) => {
    const cls = size === "big" ? "text-6xl md:text-8xl" : "text-4xl md:text-5xl";
    const stroke = "[-webkit-text-stroke:2px_white] drop-shadow-[0_6px_0_rgba(60,20,10,0.85)]";
    return (
      <h1 className={`${cls} font-[family-name:var(--font-logo)] text-center leading-none z-10 tracking-wide`}>
        <span className={`bg-gradient-to-b from-[#7CF08C] to-[#1F9E3B] bg-clip-text text-transparent ${stroke}`}>Fruit</span>{" "}
        <span className={`bg-gradient-to-b from-[#FFE066] to-[#FF8A00] bg-clip-text text-transparent ${stroke}`}>Frenzy</span>{" "}
        <span className={`bg-gradient-to-b from-[#FF7A7A] to-[#B81E1E] bg-clip-text text-transparent ${stroke}`}>Blitz</span>
      </h1>
    );
  };

  if (screen === "loading") {
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center justify-center text-white overflow-hidden`}>
        <FloatingFruits />
        <Logo size="small" />
        <div className="mt-10 w-72 h-6 bg-black/50 rounded-full overflow-hidden border-2 border-[#FFD93D]/70 z-10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]">
          <div className="h-full bg-gradient-to-r from-[#39D353] via-[#FFD93D] to-[#FF4D4D] transition-all" style={{ width: `${loadPct}%` }} />
        </div>
        <div className="mt-3 font-bold z-10 text-[#FFD93D]">{loadPct}%</div>
      </div>
    );
  }

  if (screen === "menu") {
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center justify-center text-white overflow-hidden`}>
        <FloatingFruits />
        <div className="absolute top-4 left-4 z-10 bg-black/50 backdrop-blur px-4 py-2 rounded-full font-bold border border-[#FFD93D]/40">Best: {hud.best}</div>
        <div className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur px-4 py-2 rounded-full font-bold border border-[#FFD93D]/40 text-[#FFD93D]">Coins: {hud.coins}</div>
        <Logo size="big" />
        <div className="mt-10 flex flex-col gap-4 z-10">
          <button className={`${btn} bg-gradient-to-b from-[#7CF08C] to-[#1F9E3B] text-white`} onClick={() => { sfx.click(); setScreen("modes"); }}>PLAY</button>
          <button className={`${btn} bg-gradient-to-b from-[#7DD3FC] to-[#0284C7] text-white`} onClick={() => { sfx.click(); setScreen("leaderboard"); }}>LEADERBOARD</button>
          <button className={`${btn} bg-gradient-to-b from-[#C4B5FD] to-[#7C3AED] text-white`} onClick={() => { sfx.click(); setScreen("settings"); }}>SETTINGS</button>
          <button className={`${btn} bg-gradient-to-b from-[#FF8A8A] to-[#B81E1E] text-white`} onClick={() => { sfx.click(); if (confirm("Exit game?")) window.close(); }}>EXIT</button>
        </div>
        <div className="absolute bottom-4 text-xs text-white/70 z-10 tracking-widest uppercase">by anusha shahab</div>
      </div>
    );
  }

  if (screen === "modes") {
    const cards = [
      { m: "classic" as Mode, title: "CLASSIC", desc: "Endless slicing. Dodge bombs. 3 lives.", color: "from-[#FF4D4D] to-[#FF8A00]" },
      { m: "arcade" as Mode, title: "ARCADE", desc: "90 seconds. Score as high as you can.", color: "from-[#FFD93D] to-[#FF8A00]" },
      { m: "zen" as Mode, title: "ZEN", desc: "No bombs. Pure relaxation.", color: "from-[#39D353] to-[#38BDF8]" },
    ];
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center justify-center text-white p-6 overflow-auto`}>
        <h1 className="text-5xl font-[family-name:var(--font-logo)] mb-8 tracking-wide text-[#FFD93D] drop-shadow-[0_5px_0_rgba(0,0,0,0.6)]">CHOOSE MODE</h1>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl w-full">
          {cards.map(c => (
            <button key={c.m} onClick={() => startGame(c.m)}
              className={`bg-gradient-to-br ${c.color} rounded-3xl p-8 border-2 border-[#FFD93D]/70 shadow-[0_10px_0_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.35)] hover:scale-105 hover:-translate-y-1 active:translate-y-1 transition-all text-left`}>
              <h3 className="text-3xl font-[family-name:var(--font-logo)] tracking-wide mb-2">{c.title}</h3>
              <p className="text-white/90 font-medium">{c.desc}</p>
            </button>
          ))}
        </div>
        <button onClick={() => { sfx.click(); setScreen("menu"); }} className={`mt-8 ${btn} bg-white/15 backdrop-blur`}>BACK</button>
      </div>
    );
  }

  if (screen === "leaderboard") {
    let board: Score[] = [];
    try { board = JSON.parse(localStorage.getItem("fsf_board") || "[]"); } catch { /* ignore */ }
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center text-white p-6 overflow-auto`}>
        <h1 className="text-5xl font-[family-name:var(--font-logo)] mb-6 mt-8 text-[#FFD93D] tracking-wide drop-shadow-[0_5px_0_rgba(0,0,0,0.6)]">LEADERBOARD</h1>
        <div className="w-full max-w-2xl bg-black/50 backdrop-blur rounded-3xl p-6 border-2 border-[#FFD93D]/40">
          {board.length === 0 && <p className="text-center text-white/70 py-8">No scores yet. Go play!</p>}
          {board.map((r, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b border-white/10 last:border-0">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-[family-name:var(--font-logo)] w-10 ${i === 0 ? "text-[#FFD93D]" : i === 1 ? "text-gray-300" : i === 2 ? "text-[#FF8A00]" : "text-white/60"}`}>#{i + 1}</span>
                <div>
                  <div className="font-bold text-xl">{r.score}</div>
                  <div className="text-xs text-white/60">{r.date} • Combo x{r.combo} • {r.coins} coins</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { sfx.click(); setScreen("menu"); }} className={`mt-8 ${btn} bg-white/15 backdrop-blur`}>BACK</button>
      </div>
    );
  }

  if (screen === "settings") {
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center justify-center text-white p-6`}>
        <h1 className="text-5xl font-[family-name:var(--font-logo)] mb-8 text-[#FFD93D] tracking-wide drop-shadow-[0_5px_0_rgba(0,0,0,0.6)]">SETTINGS</h1>
        <div className="w-full max-w-md bg-black/50 backdrop-blur rounded-3xl p-6 space-y-4 border-2 border-[#FFD93D]/40">
          <Toggle label="Music" on={settings.music} onChange={v => setSettings(s => ({ ...s, music: v }))} />
          <Toggle label="Sound" on={settings.sound} onChange={v => setSettings(s => ({ ...s, sound: v }))} />
          <div>
            <div className="font-bold mb-2">Graphics</div>
            <div className="flex gap-2">
              {(["high", "medium", "low"] as const).map(q => (
                <button key={q} onClick={() => setSettings(s => ({ ...s, quality: q }))}
                  className={`flex-1 py-2 rounded-xl font-bold capitalize ${settings.quality === q ? "bg-[#FFD93D] text-black" : "bg-white/10"}`}>{q}</button>
              ))}
            </div>
          </div>
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="w-full py-3 bg-white/10 rounded-xl font-bold">Fullscreen</button>
          <button onClick={() => { if (confirm("Reset high score?")) { localStorage.removeItem("fsf_best"); localStorage.removeItem("fsf_board"); setHud(h => ({ ...h, best: 0 })); } }} className="w-full py-3 bg-[#FF4D4D]/40 rounded-xl font-bold">Reset High Score</button>
        </div>
        <button onClick={() => { sfx.click(); setScreen("menu"); }} className={`mt-8 ${btn} bg-white/15 backdrop-blur`}>BACK</button>
      </div>
    );
  }

  if (screen === "gameover" && gameOverStats) {
    return (
      <div className={`fixed inset-0 ${bg} ${ui} flex flex-col items-center justify-center text-white p-6 overflow-auto`}>
        <h1 className="text-6xl font-[family-name:var(--font-combo)] mb-2 text-[#FF4D4D] drop-shadow-[0_6px_0_rgba(0,0,0,0.6)] animate-pulse tracking-wide">GAME OVER</h1>
        <div className="bg-black/50 backdrop-blur rounded-3xl p-8 mt-6 space-y-3 min-w-[300px] text-center border-2 border-[#FFD93D]/40">
          <div><div className="text-white/60 text-sm">Final Score</div><div className="text-4xl font-black text-yellow-300">{gameOverStats.score}</div></div>
          <div><div className="text-white/60 text-sm">Highest Combo</div><div className="text-2xl font-bold">x{gameOverStats.combo}</div></div>
          <div><div className="text-white/60 text-sm">Coins Collected</div><div className="text-2xl font-bold text-[#FFD93D]">{gameOverStats.coins}</div></div>
          <div><div className="text-white/60 text-sm">High Score</div><div className="text-2xl font-bold">{hud.best}</div></div>
        </div>
        <div className="flex flex-wrap gap-3 mt-8 justify-center">
          <button className={`${btn} bg-gradient-to-b from-[#7CF08C] to-[#1F9E3B]`} onClick={() => startGame(mode)}>PLAY AGAIN</button>
          <button className={`${btn} bg-gradient-to-b from-[#7DD3FC] to-[#0284C7]`} onClick={() => { sfx.click(); setScreen("menu"); }}>HOME</button>
          <button className={`${btn} bg-gradient-to-b from-[#C4B5FD] to-[#7C3AED]`} onClick={() => { sfx.click(); setScreen("leaderboard"); }}>SCORES</button>
          <button className={`${btn} bg-gradient-to-b from-[#FF9FBF] to-[#DB2777]`} onClick={async () => {
            const text = `I scored ${gameOverStats.score} in Fruit Frenzy Blitz!`;
            if (navigator.share) { try { await navigator.share({ text }); } catch { /* ignore */ } }
            else { navigator.clipboard?.writeText(text); alert("Score copied to clipboard!"); }
          }}>SHARE</button>
        </div>
      </div>
    );
  }

  // GAME
  const s = stateRef.current;
  return (
    <div className={`fixed inset-0 overflow-hidden touch-none select-none ${ui}`}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 p-3 flex items-start justify-between text-white font-bold pointer-events-none">
        <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-xl border border-[#FFD93D]/40">
          <div className="text-xs text-white/60">SCORE</div>
          <div className="text-2xl text-[#FFD93D] font-[family-name:var(--font-logo)] tracking-wide">{hud.score}</div>
        </div>
        <div className="flex flex-col items-center gap-2">
          {hud.combo > 1 && (
            <div className="bg-[#FFD93D] text-black px-4 py-1 rounded-full text-lg animate-pulse font-[family-name:var(--font-combo)] tracking-wide border-2 border-white shadow-[0_4px_0_rgba(0,0,0,0.4)]">COMBO x{hud.combo}</div>
          )}
          {mode === "arcade" && (
            <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-xl text-2xl border border-[#FFD93D]/40">{hud.time}s</div>
          )}
          <div className="bg-black/60 backdrop-blur px-3 py-1 rounded-full text-sm text-[#FFD93D] border border-[#FFD93D]/40">{hud.coins} coins</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-xl flex gap-1 border border-[#FFD93D]/40">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className={`w-3 h-3 rounded-full ${i < hud.lives ? "bg-[#FF4D4D] shadow-[0_0_8px_#FF4D4D]" : "bg-white/20"}`} />
            ))}
          </div>
          <button className="bg-[#FF8A00] w-10 h-10 rounded-full pointer-events-auto text-xl font-bold border-2 border-[#FFD93D] shadow-[0_4px_0_rgba(0,0,0,0.4)] active:translate-y-0.5"
            onClick={() => { s.running = false; setScreen("paused"); }}>||</button>
        </div>
      </div>
      {/* buffs */}
      <div className="absolute bottom-3 left-3 flex gap-2 text-white text-xs font-bold">
        {s.shield && <div className="bg-[#38BDF8]/85 px-3 py-1 rounded-full border border-white/40">SHIELD</div>}
        {performance.now() < s.doubleUntil && <div className="bg-[#FFD93D]/90 text-black px-3 py-1 rounded-full border border-white/40">2x SCORE</div>}
        {performance.now() < s.rainbowUntil && <div className="bg-[#DB2777]/85 px-3 py-1 rounded-full border border-white/40">RAINBOW</div>}
        {performance.now() < s.freezeUntil && <div className="bg-[#0284C7]/85 px-3 py-1 rounded-full border border-white/40">FROZEN</div>}
      </div>

      {screen === "paused" && (
        <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center text-white z-20">
          <h2 className="text-5xl font-[family-name:var(--font-logo)] tracking-wide mb-8 text-[#FFD93D] drop-shadow-[0_5px_0_rgba(0,0,0,0.6)]">PAUSED</h2>
          <div className="flex flex-col gap-3">
            <button className={`${btn} bg-gradient-to-b from-[#7CF08C] to-[#1F9E3B]`} onClick={() => { s.running = true; s.lastFrame = performance.now(); setScreen("game"); }}>RESUME</button>
            <button className={`${btn} bg-gradient-to-b from-[#FFE066] to-[#FF8A00]`} onClick={() => startGame(mode)}>RESTART</button>
            <button className={`${btn} bg-gradient-to-b from-[#FF8A8A] to-[#B81E1E]`} onClick={() => { sfx.click(); setScreen("menu"); }}>QUIT</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-bold">{label}</span>
      <button onClick={() => onChange(!on)} className={`w-14 h-8 rounded-full relative transition-colors ${on ? "bg-[#39D353]" : "bg-white/20"}`}>
        <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${on ? "left-7" : "left-1"}`} />
      </button>
    </div>
  );
}

function FloatingFruits() {
  const items = [
    { c: "#FF4D4D" }, { c: "#FF8A00" }, { c: "#FFD93D" }, { c: "#39D353" }, { c: "#38BDF8" },
    { c: "#FF4D4D" }, { c: "#FF8A00" }, { c: "#FFD93D" }, { c: "#39D353" }, { c: "#38BDF8" },
  ];
  return (
    <>
      {items.map((f, i) => {
        const size = 40 + ((i * 7) % 40);
        return (
          <div key={i}
            className="absolute rounded-full pointer-events-none opacity-30 blur-[1px]"
            style={{
              width: size, height: size,
              background: `radial-gradient(circle at 30% 30%, #ffffff88, ${f.c} 55%, ${f.c}dd)`,
              boxShadow: `0 0 30px ${f.c}66`,
              left: `${(i * 13) % 100}%`,
              top: `${(i * 27) % 100}%`,
              animation: `float${i % 3} ${6 + (i % 4)}s ease-in-out infinite`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes float0 { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-30px) rotate(180deg)} }
        @keyframes float1 { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-50px) rotate(-180deg)} }
        @keyframes float2 { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-20px) rotate(360deg)} }
      `}</style>
    </>
  );
}