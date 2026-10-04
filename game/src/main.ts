import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";
import "./style.css";
import * as THREE from "three";
import { createRenderer } from "./render/ps1";
import { buildWorld } from "./game/world";
import { newGame, type SaveData } from "./save/schema";
import { browserStorage, readSlot, writeSlot } from "./save/storage";

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const hud = document.getElementById("hud")!;
const help = document.getElementById("help")!;
const toastEl = document.getElementById("toast")!;

const { renderer, resize, snapRes } = createRenderer(canvas);
const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 80);
const world = buildWorld(snapRes);
resize(camera);
window.addEventListener("resize", () => resize(camera));

const kv = browserStorage();
let state: SaveData = newGame();
let pendingOverwrite = false;

// ---------- UI ----------
let toastTimer = 0;
function toast(msg: string, error = false) {
  toastEl.textContent = msg;
  toastEl.className = "show" + (error ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.className = ""), 4000);
}

help.innerHTML = [
  "<b>วิธีเล่น</b>",
  "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> เดิน &nbsp; ลากเมาส์ หมุนกล้อง",
  "<kbd>E</kbd> ตรวจดู/ใช้ &nbsp; <kbd>K</kbd> บันทึก &nbsp; <kbd>L</kbd> โหลด",
  "<kbd>H</kbd> ซ่อน/แสดงคำแนะนำ",
].join("<br>");

function renderHud() {
  const inv = state.inventory;
  hud.innerHTML = `วันที่ ${state.world.day} &nbsp;|&nbsp; ไม้ ${inv.wood} &nbsp; หิน ${inv.stone} &nbsp; เมล็ดกะหล่ำ ${inv.seed_cabbage}`;
}

function applyState() {
  const p = state.world.player;
  world.player.position.set(p.x, 0, p.z);
  world.player.rotation.y = p.facing;
  const fixed = state.story.flags.house_repaired;
  world.house.old.visible = !fixed;
  world.house.repaired.visible = fixed;
  renderHud();
}

// ---------- save / load ----------
function save() {
  const pos = world.player.position;
  state.world.player = { x: pos.x, z: pos.z, facing: world.player.rotation.y };
  state.savedAt = new Date().toISOString();
  const r = writeSlot(kv, state, { overwriteCorrupt: pendingOverwrite });
  if (r.ok) {
    pendingOverwrite = false;
    toast("บันทึกเรียบร้อย");
  } else {
    pendingOverwrite = r.reason === "corrupt-existing";
    toast(r.message, true);
  }
}

function load(initial = false) {
  const r = readSlot(kv);
  switch (r.status) {
    case "ok":
      state = r.data;
      applyState();
      toast(initial ? "โหลดเซฟล่าสุดแล้ว" : "โหลดเรียบร้อย");
      break;
    case "empty":
      if (!initial) toast("ยังไม่มีเซฟ");
      break;
    case "corrupt":
      console.warn("save rejected", r.detail);
      toast(`${r.message} (เริ่มเกมใหม่ได้ เซฟเดิมยังไม่ถูกลบ)`, true);
      break;
    case "unavailable":
      toast(r.message, true);
      break;
  }
}

// ---------- input ----------
const keys = new Set<string>();
let camYaw = 0;
let dragging = false;
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (e.repeat) return;
  if (k === "k") save();
  if (k === "l") load();
  if (k === "h") help.style.display = help.style.display === "none" ? "" : "none";
  if (k === "e") interact();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("mousedown", () => (dragging = true));
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  if (dragging) camYaw -= e.movementX * 0.008;
});

// Prototype interaction: near the house, E toggles the repaired look so the
// before/after can be checked. Real repair needs materials (chapter 1 plan).
function interact() {
  const d = world.player.position.distanceTo(new THREE.Vector3(0, 0, -3.5));
  if (d < 2.5) {
    state.story.flags.house_repaired = !state.story.flags.house_repaired;
    applyState();
    toast(state.story.flags.house_repaired ? "ซ่อมบ้านแล้ว (ต้นแบบ)" : "บ้านกลับเป็นสภาพเดิม (ต้นแบบ)");
  } else {
    toast("ไม่มีอะไรให้ตรวจดูตรงนี้");
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  right.set(-fwd.z, 0, fwd.x);
  move.set(0, 0, 0);
  if (keys.has("w") || keys.has("arrowup")) move.add(fwd);
  if (keys.has("s") || keys.has("arrowdown")) move.sub(fwd);
  if (keys.has("d") || keys.has("arrowright")) move.add(right);
  if (keys.has("a") || keys.has("arrowleft")) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(4 * dt);
    world.player.position.add(move);
    world.player.position.clampScalar(-30, 30);
    world.player.position.y = 0;
    world.player.rotation.y = Math.atan2(move.x, move.z);
  }
  const p = world.player.position;
  camera.position.set(p.x + Math.sin(camYaw) * 7, 5, p.z + Math.cos(camYaw) * 7);
  camera.lookAt(p.x, 1.2, p.z);
  renderer.render(world.scene, camera);
  requestAnimationFrame(tick);
}

applyState();
load(true);
tick();

// Read-only hook for the automated smoke test.
(window as unknown as { __game: unknown }).__game = { get state() { return state; }, save, load };
