// End-to-end smoke test. Run `npm run build` first; this serves dist/.
// Starts `vite preview`, opens the game in headless Chromium, then checks:
// it renders, the player moves, save -> reload -> auto-load works, and a
// corrupt save is reported and left untouched.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const KEY = "baan-khong-rao.save.v1";
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

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(URL);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(500);
  check("game starts with no errors", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: `${out}/01-start.png` });

  const start = await page.evaluate(() => ({ ...window.__game.state.world.player }));
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  await page.keyboard.press("k"); // save stores current position
  const saved = await page.evaluate(() => ({ ...window.__game.state.world.player }));
  check("player moves with W", Math.abs(saved.z - start.z) > 0.5, `z ${start.z} -> ${saved.z.toFixed(2)}`);
  await page.screenshot({ path: `${out}/02-moved-and-saved.png` });
  const toast1 = await page.textContent("#toast");
  check("save shows Thai confirmation", toast1?.includes("บันทึกเรียบร้อย") ?? false, toast1 ?? "");

  // Close and reopen: new page in the same context keeps localStorage.
  await page.close();
  const page2 = await ctx.newPage();
  await page2.goto(URL);
  await page2.waitForFunction(() => window.__game);
  const reloaded = await page2.evaluate(() => ({ ...window.__game.state.world.player }));
  check("progress restored after reopen", Math.abs(reloaded.z - saved.z) < 1e-6, `z=${reloaded.z.toFixed(2)}`);

  // Corrupt save: out-of-range item count.
  const bad = await page2.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.inventory.wood = 1e9;
    const t = JSON.stringify(s);
    localStorage.setItem(k, t);
    return t;
  }, KEY);
  await page2.reload();
  await page2.waitForFunction(() => window.__game);
  await page2.waitForTimeout(200);
  const toast2 = await page2.textContent("#toast");
  check("corrupt save reported to player", toast2?.includes("ไม่โหลด") ?? false, toast2 ?? "");
  const wood = await page2.evaluate(() => window.__game.state.inventory.wood);
  check("corrupt values not loaded", wood === 0);
  await page2.keyboard.press("k");
  const after = await page2.evaluate((k) => localStorage.getItem(k), KEY);
  check("first save does not overwrite corrupt save", after === bad);
  await page2.screenshot({ path: `${out}/03-corrupt-save.png` });
  await page2.keyboard.press("k");
  const backup = await page2.evaluate(() => localStorage.getItem("baan-khong-rao.save.corrupt-backup"));
  check("confirmed overwrite keeps a backup", backup === bad);
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
