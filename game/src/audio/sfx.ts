import type { Sfx } from "../sim/game";

// Tiny synthesized sound effects (WebAudio oscillators and noise): no audio
// files, so there is nothing to license. Starts after the first key or click.

let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.06, slide = 0, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

function noise(dur: number, vol = 0.08, freq = 800) {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

export function play(name: Sfx) {
  switch (name) {
    case "hoe": return noise(0.12, 0.12, 500);
    case "water": return noise(0.35, 0.06, 2500);
    case "chop": tone(180, 0.08, "square", 0.06, -60); return noise(0.08, 0.08, 1200);
    case "rock": tone(320, 0.06, "square", 0.05, -150); return noise(0.1, 0.1, 3000);
    case "plant": return tone(520, 0.08, "triangle", 0.06, 200);
    case "harvest": tone(660, 0.08, "square", 0.05); return tone(880, 0.12, "square", 0.05, 0, 0.08);
    case "coin": tone(988, 0.07, "square", 0.05); return tone(1319, 0.2, "square", 0.05, 0, 0.07);
    case "blip": return tone(740, 0.04, "square", 0.03);
    case "sleep": tone(523, 0.3, "triangle", 0.06); tone(659, 0.3, "triangle", 0.06, 0, 0.25); return tone(784, 0.5, "triangle", 0.06, 0, 0.5);
    case "deny": return tone(160, 0.15, "square", 0.05, -40);
    case "door": return noise(0.18, 0.08, 400);
    case "bark": tone(420, 0.06, "sawtooth", 0.05, -150); return tone(420, 0.06, "sawtooth", 0.05, -150, 0.12);
  }
}
