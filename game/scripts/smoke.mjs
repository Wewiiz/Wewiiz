// End-to-end browser test. Run `npm run build` first; this serves dist/.
// Plays chapter 1 from the title screen to the ending with real key presses
// (positions are set through a test hook instead of walking), then checks
// autosave, closing and reopening, manual save/load and corrupt-save handling.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const KEY = "baan-khong-rao.save.v1";
const BACKUP = "baan-khong-rao.save.corrupt-backup";
const out = process.argv[2] ?? "test-results";
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
await new Promise((res, rej) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && res());
  server.on("exit", (c) => rej(new Error(`preview exited ${c}`)));
});

const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch({ ...launch, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const t0 = Date.now();

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)));
const mode = (page) => page.evaluate(() => window.__game.mode);

/** Clicks through dialogue/fades with E, answering choices by number. */
async function talk(page, ...choices) {
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(() => ({ mode: window.__game.mode, n: document.querySelectorAll("#choices button").length }));
    if (s.mode === "play" || s.mode === "ending" || s.mode === "title") return s.mode;
    if (s.mode === "dialogue" && s.n > 0) await page.keyboard.press(String(choices.shift() ?? 1));
    else await page.keyboard.press("e");
    await page.waitForTimeout(30);
  }
  throw new Error("dialogue did not finish");
}

/** Stand so that (x, z) is right in front of the player. */
async function face(page, x, z, loc = "farm") {
  await page.evaluate(([x, z, loc]) => window.__game.teleport(x, z - 0.9, 0, loc), [x, z, loc]);
}

async function useAt(page, toolKey, x, z) {
  await face(page, x, z);
  await page.keyboard.press(toolKey);
  await page.keyboard.press("Space");
  await talk(page);
}

async function sleep(page) {
  const d = await page.evaluate(() => window.__game.data.BED);
  await page.evaluate(([x, z]) => window.__game.teleport(x + 1.5, z, -Math.PI / 2, "house"), [d.x, d.z]);
  await page.keyboard.press("e");
  return talk(page, 1);
}

async function gatherAll(page) {
  const s = await state(page);
  const debris = await page.evaluate(() => window.__game.data.DEBRIS);
  for (let i = 0; i < debris.length; i++) {
    if (!s.world.debris[i]) continue;
    const d = debris[i];
    await useAt(page, d.kind === "branch" || d.kind === "stump" ? "4" : "5", d.x, d.z);
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // ---- start
  await page.goto(URL);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(400);
  check("title screen shows with no errors", (await mode(page)) === "title" && errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `${out}/01-title.png` });
  await page.keyboard.press("Enter"); // "เริ่มเกมใหม่" is selected when there is no save
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/02-intro-letter.png` });
  await talk(page);
  check("new game starts after intro letter", (await mode(page)) === "play");

  // ---- caretaker hands over tools
  const care = { x: 11.6, z: 2.2 };
  await face(page, care.x, care.z);
  await page.keyboard.press("e");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/03-caretaker.png` });
  await talk(page, 1);
  let s = await state(page);
  check("talking to the caretaker gives tools", s.story.flags.met_caretaker);

  // ---- day 1: till, plant, water
  const F = await page.evaluate(() => window.__game.data.FIELD);
  const debris = await page.evaluate(() => window.__game.data.DEBRIS);
  const blocked = new Set(debris.map((d) => `${Math.floor(d.x - F.x0)},${Math.floor(d.z - F.z0)}`));
  const plot = [];
  for (let r = 0; r < F.rows && plot.length < 6; r++)
    for (let c = 0; c < F.cols && plot.length < 6; c++) if (!blocked.has(`${c},${r}`)) plot.push({ x: F.x0 + c + 0.5, z: F.z0 + r + 0.5, i: r * F.cols + c });
  for (const t of plot) {
    await useAt(page, "2", t.x, t.z);
    await useAt(page, "6", t.x, t.z);
    await useAt(page, "3", t.x, t.z);
  }
  s = await state(page);
  check("till, plant and water 6 tiles", plot.every((t) => s.world.tiles[t.i].crop === "radish" && s.world.tiles[t.i].watered));
  await page.screenshot({ path: `${out}/04-planted.png` });
  await gatherAll(page);
  s = await state(page);
  check("axe and hammer collect wood and stone", s.inventory.wood > 0 && s.inventory.stone > 0, `wood ${s.inventory.wood} stone ${s.inventory.stone} stamina ${s.world.stamina}`);

  // ---- nights until harvest
  const night = async () => {
    const before = (await state(page)).world.day;
    await sleep(page);
    const after = await state(page);
    return after.world.day === before + 1;
  };
  check("sleeping in bed starts the next day", await night());
  const autosaved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
  check("sleeping autosaves", autosaved?.world?.day === 2);
  for (const t of plot) await useAt(page, "3", t.x, t.z);
  await gatherAll(page);
  await night();
  s = await state(page);
  check("day 3 is rainy and waters the field", s.world.weather === "rain" && plot.every((t) => s.world.tiles[t.i].watered));
  await face(page, plot[0].x, plot[0].z);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/05-rain.png` });
  await gatherAll(page);
  await night();

  // ---- day 4: harvest and ship
  for (const t of plot) {
    await face(page, t.x, t.z);
    await page.keyboard.press("e");
    await talk(page);
  }
  s = await state(page);
  check("harvest 6 radishes", s.inventory.radish === 6, `radish ${s.inventory.radish}`);
  const BIN = await page.evaluate(() => window.__game.data.SHIPPING_BIN);
  await face(page, BIN.x, BIN.z - 0.4);
  await page.keyboard.press("e");
  await talk(page, 1);
  s = await state(page);
  check("ship radishes", s.world.shippingBin === 6);
  for (let k = 0; k < 8 && (s.inventory.wood < 30 || s.inventory.stone < 15 || s.world.shippingBin > 0); k++) {
    await gatherAll(page);
    await night();
    s = await state(page);
  }
  check("paid for shipped crops overnight", s.stats.earned === 360 && s.inventory.money >= 300, `money ${s.inventory.money}`);

  // ---- repair
  const WB = await page.evaluate(() => window.__game.data.WORKBENCH);
  await face(page, WB.x, WB.z - 0.2);
  await page.keyboard.press("e");
  await talk(page, 1);
  s = await state(page);
  check("repair the house at the workbench", s.story.flags.house_repaired && s.inventory.money < 300);
  await page.evaluate(() => window.__game.teleport(0, 4, Math.PI));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/06-house-repaired-evening.png` });
  await page.evaluate(() => window.__game.teleport(0, 58, Math.PI, "house"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/07-interior-repaired.png` });
  await night();

  // ---- visitor, clue, choice
  await page.evaluate(() => window.__game.setTime(9 * 60));
  const V = await page.evaluate(() => window.__game.data.VISITOR_SPOT);
  await face(page, V.x, V.z);
  await page.keyboard.press("e");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/08-visitor.png` });
  await talk(page, 1);
  s = await state(page);
  check("meet the returning visitor", s.story.flags.met_visitor);
  const C = await page.evaluate(() => window.__game.data.CHEST);
  await face(page, C.x, C.z - 0.3, "house");
  await page.keyboard.press("e");
  await talk(page);
  s = await state(page);
  check("find the clue in grandfather's chest", s.story.flags.found_clue);
  await face(page, V.x, V.z);
  await page.keyboard.press("e");
  const end = await talk(page, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/09-ending.png` });
  s = await state(page);
  check("choose a path and reach the chapter ending", end === "ending" && s.story.choice === "stay_and_rebuild" && s.story.flags.chapter_done);
  const endText = await page.textContent("#endstats");
  console.log("      ending stats:", endText?.replace(/\s+/g, " "));
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
  check("ending is saved", saved?.story?.flags?.chapter_done === true);

  // ---- close and reopen
  await page.close();
  const page2 = await ctx.newPage();
  page2.on("pageerror", (e) => errors.push(String(e)));
  await page2.goto(URL);
  await page2.waitForFunction(() => window.__game);
  const cont = await page2.textContent("#menu button");
  check("title offers continue after reopening", cont?.includes("เล่นต่อ (วันที่") ?? false, cont ?? "");
  await page2.keyboard.press("Enter");
  await page2.waitForTimeout(300);
  s = await state(page2);
  check("continue loads the finished chapter", s.story.flags.chapter_done && s.story.choice === "stay_and_rebuild");

  // ---- manual save and load
  await page2.evaluate(() => window.__game.teleport(0, 3, Math.PI));
  await page2.keyboard.press("k");
  const savedZ = (await state(page2)).world.player.z;
  await page2.keyboard.down("s");
  await page2.waitForTimeout(500);
  await page2.keyboard.up("s");
  const movedZ = (await state(page2)).world.player.z;
  await page2.keyboard.press("l");
  const loadedZ = (await state(page2)).world.player.z;
  check("K saves and L loads position", Math.abs(movedZ - savedZ) > 0.5 && Math.abs(loadedZ - savedZ) < 1e-6, `${savedZ.toFixed(2)} -> ${movedZ.toFixed(2)} -> ${loadedZ.toFixed(2)}`);

  // ---- corrupt save
  const bad = await page2.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.inventory.money = -5;
    s.inventory.wood = "lots";
    const t = JSON.stringify(s);
    localStorage.setItem(k, t);
    return t;
  }, KEY);
  await page2.reload();
  await page2.waitForFunction(() => window.__game);
  await page2.waitForTimeout(200);
  const msg = await page2.textContent("#titlemsg");
  const contDisabled = await page2.evaluate(() => document.querySelector("#menu button").disabled);
  check("corrupt save is reported on the title screen", (msg?.includes("ไม่โหลด") ?? false) && contDisabled, msg ?? "");
  await page2.screenshot({ path: `${out}/10-corrupt-save.png` });
  await page2.keyboard.press("Enter"); // new game
  await talk(page2);
  await page2.keyboard.press("k");
  const after1 = await page2.evaluate((k) => localStorage.getItem(k), KEY);
  const toast = await page2.textContent("#toast");
  check("first save does not overwrite the corrupt save", after1 === bad && (toast?.includes("เสียหาย") ?? false), toast ?? "");
  await page2.keyboard.press("k");
  const after2 = await page2.evaluate(([k, b]) => [localStorage.getItem(k), localStorage.getItem(b)], [KEY, BACKUP]);
  check("confirmed overwrite keeps a backup", after2[1] === bad && after2[0] !== bad);

  check("no page errors during the run", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
