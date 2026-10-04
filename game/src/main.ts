import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";
import "./style.css";
import * as THREE from "three";
import { createRenderer } from "./render/ps1";
import { WorldView } from "./game/world";
import { Game, type Dialogue, type GameEvent } from "./sim/game";
import * as DATA from "./sim/data";
import { INTERIOR, ITEM_NAMES, STAMINA_MAX, TOOL_IDS, TOOL_NAMES, type ToolId } from "./sim/data";
import { newGame, type EndingChoice } from "./save/schema";
import { browserStorage, readSlot, writeSlot } from "./save/storage";
import { play as playSfx, toggleMute, unlockAudio } from "./audio/sfx";

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("screen") as HTMLCanvasElement;

const { renderer, resize, snapRes } = createRenderer(canvas);
const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 120);
const view = new WorldView(snapRes);
resize(camera);
window.addEventListener("resize", () => resize(camera));

const kv = browserStorage();
let game = new Game(newGame());
let mode: "title" | "play" | "dialogue" | "fade" | "ending" = "title";
let pendingOverwrite = false;

// ------------------------------------------------------------------ toast
let toastTimer = 0;
function toast(msg: string, error = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "show" + (error ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = ""), error ? 5000 : 3000);
}

// ------------------------------------------------------------ save / load
function save(auto = false): boolean {
  game.state.savedAt = new Date().toISOString();
  const r = writeSlot(kv, game.state, { overwriteCorrupt: pendingOverwrite });
  if (r.ok) {
    pendingOverwrite = false;
    toast(auto ? "บันทึกอัตโนมัติแล้ว" : "บันทึกเรียบร้อย");
    return true;
  }
  pendingOverwrite = r.reason === "corrupt-existing";
  toast(r.message, true);
  return false;
}

function loadFromSlot(): boolean {
  const r = readSlot(kv);
  if (r.status === "ok") {
    game = new Game(r.data);
    snapCamera();
    toast("โหลดเรียบร้อย");
    return true;
  }
  if (r.status === "corrupt") console.warn("save rejected", r.detail);
  toast(r.status === "empty" ? "ยังไม่มีเซฟ" : r.message, r.status !== "empty");
  return false;
}

// ------------------------------------------------------------- title menu
function menu(container: HTMLElement, items: { label: string; action: () => void; disabled?: boolean }[]) {
  container.innerHTML = "";
  const buttons = items.map((it) => {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.addEventListener("click", () => {
      unlockAudio();
      it.action();
    });
    container.appendChild(b);
    return b;
  });
  let sel = buttons.findIndex((b) => !b.disabled);
  const mark = () => buttons.forEach((b, i) => b.classList.toggle("sel", i === sel));
  mark();
  return {
    move(d: number) {
      if (sel < 0) return;
      do sel = (sel + d + buttons.length) % buttons.length;
      while (buttons[sel].disabled);
      mark();
    },
    activate() {
      if (sel >= 0) buttons[sel].click();
    },
  };
}
let activeMenu: ReturnType<typeof menu> | null = null;

const HOWTO = `<div class="howto">
<b>การควบคุม (คีย์บอร์ดและเมาส์)</b><br>
<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> หรือลูกศร เดิน · <kbd>Shift</kbd> วิ่ง<br>
<kbd>E</kbd> คุย / ตรวจดู / เก็บผัก / ใช้ของ · <kbd>Space</kbd> หรือคลิกซ้าย ใช้เครื่องมือ<br>
<kbd>1</kbd>–<kbd>6</kbd> เลือกเครื่องมือ · <kbd>Q</kbd> / ล้อเมาส์+<kbd>Ctrl</kbd> สลับเครื่องมือ<br>
ลากเมาส์ขวา หรือ <kbd>Z</kbd> <kbd>C</kbd> หมุนกล้อง · ล้อเมาส์ ซูม<br>
<kbd>K</kbd> บันทึก · <kbd>L</kbd> โหลด · <kbd>H</kbd> ซ่อนคำแนะนำ · <kbd>M</kbd> ปิดเสียง<br><br>
<b>วิธีเล่น</b><br>
พรวนดินด้วยจอบ → หว่านเมล็ด → รดน้ำทุกวัน → นอนครบ 3 คืน → เก็บเกี่ยว → ใส่กล่องส่งขาย<br>
เก็บไม้ด้วยขวานและหินด้วยค้อน แล้วซ่อมบ้านที่โต๊ะช่าง · ทุกการกระทำใช้แรง นอนที่ฟูกในบ้านเพื่อพักและบันทึก
</div>`;

function showTitle() {
  mode = "title";
  setHud(false);
  $("title").hidden = false;
  $("ending").hidden = true;
  const r = readSlot(kv);
  const msg = $("titlemsg");
  msg.textContent =
    r.status === "corrupt"
      ? `${r.message} · กด "เริ่มเกมใหม่" ได้ เซฟเดิมจะไม่ถูกลบจนกว่าคุณยืนยันการบันทึกทับ`
      : r.status === "unavailable"
        ? `${r.message} · เล่นได้ แต่บันทึกความคืบหน้าไม่ได้`
        : "";
  let confirmNew = false;
  const build = () => {
    activeMenu = menu($("menu"), [
      { label: r.status === "ok" ? `เล่นต่อ (วันที่ ${r.data.world.day})` : "เล่นต่อ", disabled: r.status !== "ok", action: () => r.status === "ok" && startGame(new Game(r.data)) },
      {
        label: confirmNew ? "ยืนยันเริ่มใหม่? (เซฟเดิมจะถูกทับเมื่อบันทึก)" : "เริ่มเกมใหม่",
        action: () => {
          if (r.status === "ok" && !confirmNew) {
            confirmNew = true;
            build();
            return;
          }
          startGame(new Game(newGame()));
        },
      },
      { label: "วิธีเล่น", action: () => (msg.innerHTML = HOWTO) },
    ]);
  };
  build();
}

function startGame(g: Game) {
  game = g;
  $("title").hidden = true;
  $("ending").hidden = true;
  activeMenu = null;
  mode = "play";
  setHud(true);
  snapCamera();
  game.intro();
  pump();
}

// ---------------------------------------------------------------- dialogue
type Present = { type: "dialogue"; d: Dialogue } | { type: "fade"; text: string } | { type: "ending"; choice: EndingChoice };
const queue: Present[] = [];
let endingPending: EndingChoice | null = null;
let current: { d: Dialogue; line: number; shown: number; choice: number } | null = null;
let fadeUntil = 0;

/** Moves game events into the presentation queue and handles instant ones. */
function pump(extra?: Dialogue | null) {
  const evs: GameEvent[] = game.takeEvents();
  const later: Present[] = [];
  for (const e of evs) {
    switch (e.type) {
      case "toast": toast(e.text, e.error); break;
      case "sfx": playSfx(e.name); break;
      case "autosave": save(true); break;
      case "teleport": snapCamera(); break;
      case "fade": queue.push({ type: "fade", text: e.text }); break;
      case "dialogue": later.push({ type: "dialogue", d: e.dialogue }); break;
      case "ending": endingPending = e.choice; break;
    }
  }
  if (extra) queue.push({ type: "dialogue", d: extra });
  queue.push(...later);
  if (mode === "play" && (queue.length || endingPending)) next();
}

function next() {
  const p = queue.shift();
  if (!p) {
    if (endingPending) {
      const c = endingPending;
      endingPending = null;
      return showEnding(c);
    }
    mode = "play";
    $("dialogue").hidden = true;
    $("fade").hidden = true;
    return;
  }
  if (p.type === "fade") {
    mode = "fade";
    $("dialogue").hidden = true;
    $("fade").hidden = false;
    $("fadetext").textContent = p.text;
    fadeUntil = performance.now() + 2200;
  } else if (p.type === "dialogue") {
    mode = "dialogue";
    $("fade").hidden = true;
    current = { d: p.d, line: 0, shown: 0, choice: 0 };
    $("dialogue").hidden = false;
    renderLine();
  } else showEnding(p.choice);
}

function renderLine() {
  if (!current) return;
  const line = current.d.lines[current.line];
  $("speaker").textContent = line.who ?? "";
  const full = line.text;
  const txt = full.slice(0, Math.floor(current.shown));
  $("dtext").textContent = txt;
  const last = current.line === current.d.lines.length - 1;
  const done = current.shown >= full.length;
  const ch = $("choices");
  if (last && done && current.d.choices) {
    if (!ch.childElementCount) {
      current.d.choices.forEach((c, i) => {
        const b = document.createElement("button");
        b.textContent = `${i + 1}. ${c.label}`;
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          pick(i);
        });
        ch.appendChild(b);
      });
    }
    [...ch.children].forEach((b, i) => b.classList.toggle("sel", i === current!.choice));
    $("dnext").hidden = true;
  } else {
    ch.innerHTML = "";
    $("dnext").hidden = !done;
  }
}

function advanceDialogue() {
  if (!current) return;
  const line = current.d.lines[current.line];
  if (current.shown < line.text.length) {
    current.shown = line.text.length;
    return renderLine();
  }
  if (current.line < current.d.lines.length - 1) {
    current.line++;
    current.shown = 0;
    playSfx("blip");
    return renderLine();
  }
  if (current.d.choices) return pick(current.choice);
  current = null;
  $("choices").innerHTML = "";
  $("dialogue").hidden = true;
  mode = "play";
  pump();
}

function pick(i: number) {
  if (!current?.d.choices) return;
  const c = current.d.choices[i];
  if (!c) return;
  current = null;
  $("choices").innerHTML = "";
  $("dialogue").hidden = true;
  mode = "play";
  const nextD = c.pick();
  pump(nextD);
}

// ------------------------------------------------------------------ ending
function showEnding(choice: EndingChoice) {
  mode = "ending";
  $("dialogue").hidden = true;
  $("fade").hidden = true;
  setHud(false);
  const st = game.state;
  const stay = choice === "stay_and_rebuild";
  $("endtitle").textContent = stay ? "จบบทที่ 1 · บ้านที่มีคนอยู่" : "จบบทที่ 1 · ตามรอยห้วยเย็น";
  $("endtext").textContent = stay
    ? "นิดตัดสินใจอยู่ช่วยดูแลไร่ แปลงผักขยายจนเต็มลาน\nทุกค่ำ ไฟจากบ้านของคุณตาสว่างให้คนทั้งหมู่บ้านเห็น\nไม่นาน เพื่อนบ้านคนแรกก็เริ่มเดินขึ้นเนินมาขอซื้อผัก...\n\nบทถัดไป: ฤดูเก็บเกี่ยวแรก"
    : "รุ่งเช้า เธอกับนิดออกเดินตามแผนที่ของคุณตา\nทางขึ้นเขารกและชัน จนในที่สุดก็เห็นผาหิน\nกองดินกับหินขนาดใหญ่ขวางทางน้ำไว้ ได้ยินเสียงน้ำไหลอยู่ข้างหลัง...\n\nบทถัดไป: ต้นน้ำที่หายไป";
  const mins = Math.floor(st.stats.playSeconds / 60);
  const secs = Math.floor(st.stats.playSeconds % 60);
  const fr = st.story.friendship;
  $("endstats").innerHTML = [
    `ใช้เวลาในเกม: ${st.world.day} วัน`,
    `เวลาเล่นจริง: ${mins} นาที ${secs} วินาที`,
    `ส่งขายหัวไชเท้า: ${st.stats.shipped} หัว · รายได้ ${st.stats.earned} เหรียญ`,
    `ความสนิท: ป้าบุญ ${fr.caretaker} · นิด ${fr.visitor} · เจ้าโบ้ ${fr.dog}`,
  ].join("<br>");
  save(true);
  $("ending").hidden = false;
  activeMenu = menu($("endmenu"), [
    {
      label: "ใช้ชีวิตในไร่ต่อ",
      action: () => {
        $("ending").hidden = true;
        activeMenu = null;
        mode = "play";
        setHud(true);
      },
    },
    { label: "กลับหน้าแรก", action: showTitle },
  ]);
}

// ---------------------------------------------------------------------- HUD
function setHud(on: boolean) {
  for (const id of ["hud", "objective", "inventory", "toolbar"]) $(id).hidden = !on;
  $("help").hidden = !on || helpHidden;
}
let helpHidden = false;
$("help").innerHTML = [
  "<kbd>WASD</kbd> เดิน · <kbd>Shift</kbd> วิ่ง",
  "<kbd>E</kbd> คุย / ตรวจ / เก็บผัก",
  "<kbd>Space</kbd> หรือคลิก ใช้เครื่องมือ",
  "<kbd>1</kbd>-<kbd>6</kbd> เลือกเครื่องมือ",
  "<kbd>Z</kbd><kbd>C</kbd> หรือลากเมาส์ขวา หมุนกล้อง",
  "<kbd>K</kbd> บันทึก · <kbd>L</kbd> โหลด",
  "<kbd>M</kbd> เสียง · <kbd>H</kbd> ซ่อนกล่องนี้",
].join("<br>");

const toolbar = $("toolbar");
TOOL_IDS.forEach((t, i) => {
  const d = document.createElement("div");
  d.className = "slot";
  d.dataset.tool = t;
  d.addEventListener("click", () => game.selectTool(t));
  toolbar.appendChild(d);
  d.innerHTML = `<kbd>${i + 1}</kbd> ${TOOL_NAMES[t]}<br><small></small>`;
});

let hudTimer = 0;
function renderHud() {
  const st = game.state;
  const w = st.world;
  $("date").textContent = `${game.dateText()} ${w.weather === "rain" ? "☂ ฝนตก" : "☀ แดดดี"}`;
  $("clock").textContent = game.clockText();
  const pct = (w.stamina / STAMINA_MAX) * 100;
  ($("stamina").querySelector("i") as HTMLElement).style.width = `${pct}%`;
  $("stamina").classList.toggle("low", pct < 25);
  $("money").textContent = `เงิน ${st.inventory.money} เหรียญ`;
  $("objective").innerHTML = `<b>เป้าหมาย:</b> ${game.objective()}`;
  const inv = st.inventory;
  $("inventory").innerHTML = (["wood", "stone", "radish", "seed_radish"] as const).map((k) => `${ITEM_NAMES[k]} ${inv[k]}`).join("<br>");
  for (const el of toolbar.children) {
    const t = (el as HTMLElement).dataset.tool as ToolId;
    el.classList.toggle("on", t === w.tool);
    const small = el.querySelector("small")!;
    small.textContent = t === "can" ? `น้ำ ${w.water}` : t === "seeds" ? `${inv.seed_radish} ซอง` : "";
  }
}

// ------------------------------------------------------------------- input
const keys = new Set<string>();
let camYaw = 0;
let camDist = 9;
let rDrag = false;

function onKey(e: KeyboardEvent) {
  unlockAudio();
  const k = e.key.toLowerCase();
  if (["tab", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
  if (k === "m") return toast(toggleMute() ? "ปิดเสียงแล้ว" : "เปิดเสียงแล้ว");

  if (mode === "title" || mode === "ending") {
    if (k === "arrowdown" || k === "s") activeMenu?.move(1);
    if (k === "arrowup" || k === "w") activeMenu?.move(-1);
    if (k === "enter" || k === " " || k === "e") activeMenu?.activate();
    return;
  }
  if (mode === "fade") {
    if (k === "enter" || k === " " || k === "e") fadeUntil = 0;
    return;
  }
  if (mode === "dialogue" && current) {
    const choices = current.d.choices;
    const atChoice = choices && current.line === current.d.lines.length - 1 && current.shown >= current.d.lines[current.line].text.length;
    if (atChoice) {
      if (k === "arrowdown" || k === "s") current.choice = (current.choice + 1) % choices.length;
      if (k === "arrowup" || k === "w") current.choice = (current.choice - 1 + choices.length) % choices.length;
      const n = Number(k);
      if (n >= 1 && n <= choices.length) return pick(n - 1);
      renderLine();
    }
    if (k === "enter" || k === " " || k === "e") advanceDialogue();
    return;
  }
  if (mode !== "play") return;
  keys.add(k);
  if (e.repeat) return;
  const n = Number(k);
  if (n >= 1 && n <= TOOL_IDS.length) game.selectTool(TOOL_IDS[n - 1]);
  if (k === "q" || k === "tab") game.cycleTool(e.shiftKey ? -1 : 1);
  if (k === "e") game.interact();
  if (k === " ") useTool();
  if (k === "k") save();
  if (k === "l") loadFromSlot();
  if (k === "h") {
    helpHidden = !helpHidden;
    $("help").hidden = helpHidden;
  }
  pump();
}
window.addEventListener("keydown", onKey);
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

function useTool() {
  view.swing = 1;
  game.useTool();
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  unlockAudio();
  if (e.button === 2) rDrag = true;
  if (e.button === 0) {
    if (mode === "play") {
      useTool();
      pump();
    } else if (mode === "dialogue") advanceDialogue();
    else if (mode === "fade") fadeUntil = 0;
  }
});
$("dialogue").addEventListener("click", () => mode === "dialogue" && advanceDialogue());
$("fade").addEventListener("click", () => (fadeUntil = 0));
window.addEventListener("mouseup", (e) => e.button === 2 && (rDrag = false));
window.addEventListener("mousemove", (e) => {
  if (rDrag) camYaw -= e.movementX * 0.008;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey) game.cycleTool(e.deltaY > 0 ? 1 : -1);
    else camDist = Math.max(5, Math.min(15, camDist + Math.sign(e.deltaY)));
  },
  { passive: false },
);

// ------------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function cameraGoal(out: THREE.Vector3, look: THREE.Vector3) {
  const p = game.state.world.player;
  if (game.state.world.location === "house") {
    look.set(INTERIOR.x, 0.8, INTERIOR.z - 0.3);
    out.set(INTERIOR.x + Math.sin(camYaw) * 2, 8.5, INTERIOR.z + 6.5);
  } else {
    look.set(p.x, 1.1, p.z);
    out.set(p.x + Math.sin(camYaw) * camDist, camDist * 0.8, p.z + Math.cos(camYaw) * camDist);
  }
}
const goal = new THREE.Vector3();
function snapCamera() {
  cameraGoal(goal, camTarget);
  camera.position.copy(goal);
  camera.lookAt(camTarget);
}

// --------------------------------------------------------------------- loop
const clock = new THREE.Clock();
const look = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const mv = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  let moving = false;
  if (mode !== "title") game.state.stats.playSeconds = Math.min(99_999_999, game.state.stats.playSeconds + dt);

  if (mode === "play") {
    if (keys.has("z")) camYaw += dt * 1.8;
    if (keys.has("c")) camYaw -= dt * 1.8;
    fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    right.set(-fwd.z, 0, fwd.x);
    mv.set(0, 0, 0);
    if (keys.has("w") || keys.has("arrowup")) mv.add(fwd);
    if (keys.has("s") || keys.has("arrowdown")) mv.sub(fwd);
    if (keys.has("d") || keys.has("arrowright")) mv.add(right);
    if (keys.has("a") || keys.has("arrowleft")) mv.sub(right);
    if (mv.lengthSq() > 0) {
      moving = true;
      mv.normalize().multiplyScalar((keys.has("shift") ? 6 : 3.6) * dt);
      game.move(mv.x, mv.z);
    }
    game.tick(dt);
    pump();
  } else if (mode === "dialogue" && current) {
    const line = current.d.lines[current.line];
    if (current.shown < line.text.length) {
      current.shown = Math.min(line.text.length, current.shown + dt * 60);
      renderLine();
    }
  } else if (mode === "fade" && performance.now() > fadeUntil) {
    next();
  }

  view.sync(game, dt, moving);
  cameraGoal(goal, look);
  camera.position.lerp(goal, Math.min(1, dt * 6));
  camTarget.lerp(look, Math.min(1, dt * 8));
  camera.lookAt(camTarget);
  renderer.render(view.scene, camera);

  hudTimer -= dt;
  if (hudTimer <= 0 && mode !== "title") {
    hudTimer = 0.15;
    renderHud();
  }
  requestAnimationFrame(frame);
}

showTitle();
snapCamera();
frame();

// Hook for the automated browser test: read state and set up positions.
// Actions themselves go through real key presses.
(window as unknown as { __game: unknown }).__game = {
  data: DATA,
  get state() {
    return game.state;
  },
  get mode() {
    return mode;
  },
  get dialogue() {
    return current ? { line: current.d.lines[current.line], choices: current.d.choices?.map((c) => c.label) ?? [] } : null;
  },
  teleport(x: number, z: number, facing: number, location: "farm" | "house" = "farm") {
    Object.assign(game.state.world, { location });
    Object.assign(game.state.world.player, { x, z, facing });
    snapCamera();
  },
  setTime(min: number) {
    game.state.world.time = min;
  },
};
