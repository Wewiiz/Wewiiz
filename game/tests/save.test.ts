import { describe, expect, it } from "vitest";
import { LIMITS, SAVE_VERSION, migrate, newGame, validateSave } from "../src/save/schema";
import { CORRUPT_BACKUP_KEY, SLOT_KEY, readSlot, writeSlot, type KV } from "../src/save/storage";

function memKV(init: Record<string, string> = {}): KV & { store: Record<string, string> } {
  const store = { ...init };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("validateSave", () => {
  it("accepts a new game", () => {
    expect(validateSave(newGame()).ok).toBe(true);
  });

  it.each([
    ["string item count", (s: any) => (s.inventory.wood = "5")],
    ["negative item count", (s: any) => (s.inventory.wood = -1)],
    ["item count over limit", (s: any) => (s.inventory.stone = LIMITS.itemMax + 1)],
    ["fractional count", (s: any) => (s.inventory.seed_radish = 1.5)],
    ["money over limit", (s: any) => (s.inventory.money = LIMITS.moneyMax + 1)],
    ["money as string", (s: any) => (s.inventory.money = "300")],
    ["NaN day (serialised as null)", (s: any) => (s.world.day = null)],
    ["day zero", (s: any) => (s.world.day = 0)],
    ["clock past midnight", (s: any) => (s.world.time = 25 * 60)],
    ["negative stamina", (s: any) => (s.world.stamina = -5)],
    ["unknown weather", (s: any) => (s.world.weather = "snow")],
    ["unknown location", (s: any) => (s.world.location = "moon")],
    ["unknown tool", (s: any) => (s.world.tool = "chainsaw")],
    ["missing story flag", (s: any) => delete s.story.flags.met_caretaker],
    ["flag not boolean", (s: any) => (s.story.flags.found_clue = "yes")],
    ["unknown choice", (s: any) => (s.story.choice = "sell_house")],
    ["friendship over max", (s: any) => (s.story.friendship.dog = 101)],
    ["player off map", (s: any) => (s.world.player.x = 1e9)],
    ["crop growth too high", (s: any) => Object.assign(s.world.tiles[0], { tilled: true, crop: "radish", growth: 9 })],
    ["crop on untilled soil", (s: any) => Object.assign(s.world.tiles[0], { crop: "radish" })],
    ["too few tiles", (s: any) => s.world.tiles.pop()],
    ["debris list wrong length", (s: any) => s.world.debris.pop()],
    ["missing stats", (s: any) => delete s.stats],
    ["future version", (s: any) => (s.version = 99)],
  ])("rejects %s", (_name, mutate) => {
    const s = clone(newGame());
    mutate(s);
    expect(validateSave(s).ok).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const v of [null, 1, "x", [], undefined]) expect(validateSave(v).ok).toBe(false);
  });

  it("keeps story progress separate from item counts", () => {
    const s = newGame();
    expect(Object.keys(s.story)).not.toContain("inventory");
    expect(Object.keys(s.inventory).sort()).toEqual(["money", "radish", "seed_radish", "stone", "wood"]);
  });
});

describe("migrate", () => {
  it("upgrades a v1 prototype save", () => {
    const v1 = {
      version: 1,
      savedAt: "2026-10-04T12:00:00.000Z",
      story: { chapter: 1, flags: { intro_done: true, met_caretaker: true }, choice: null },
      inventory: { wood: 12, stone: 4, seed_cabbage: 0, cabbage: 0, water: 0 },
      world: { day: 3, player: { x: 0, z: 0, facing: 0 }, plots: [] },
    };
    const r = validateSave(migrate(v1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.version).toBe(SAVE_VERSION);
      expect(r.data.inventory.wood).toBe(12);
      expect(r.data.world.day).toBe(3);
      expect(r.data.story.flags.met_caretaker).toBe(true);
    }
  });

  it("does not trust bad v1 values", () => {
    const r = validateSave(migrate({ version: 1, inventory: { wood: -9, stone: "x" }, world: { day: 1e9 } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.data.inventory.wood, r.data.inventory.stone, r.data.world.day]).toEqual([0, 0, 1]);
  });
});

describe("storage", () => {
  it("round-trips a save", () => {
    const kv = memKV();
    const g = newGame();
    g.inventory.wood = 12;
    g.story.flags.met_caretaker = true;
    expect(writeSlot(kv, g)).toEqual({ ok: true });
    const r = readSlot(kv);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data.inventory.wood).toBe(12);
      expect(r.data.story.flags.met_caretaker).toBe(true);
    }
  });

  it("reports empty slot", () => {
    expect(readSlot(memKV()).status).toBe("empty");
  });

  it("reports unavailable storage", () => {
    expect(readSlot(null).status).toBe("unavailable");
    expect(writeSlot(null, newGame()).ok).toBe(false);
  });

  it("flags unparseable JSON as corrupt", () => {
    expect(readSlot(memKV({ [SLOT_KEY]: "{not json" })).status).toBe("corrupt");
  });

  it("does not overwrite a corrupt save without confirmation", () => {
    const kv = memKV({ [SLOT_KEY]: "{broken" });
    const r = writeSlot(kv, newGame());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("corrupt-existing");
    expect(kv.store[SLOT_KEY]).toBe("{broken");
  });

  it("backs up the corrupt save when overwrite is confirmed", () => {
    const kv = memKV({ [SLOT_KEY]: "{broken" });
    expect(writeSlot(kv, newGame(), { overwriteCorrupt: true }).ok).toBe(true);
    expect(kv.store[CORRUPT_BACKUP_KEY]).toBe("{broken");
    expect(readSlot(kv).status).toBe("ok");
  });

  it("refuses to write invalid game state", () => {
    const kv = memKV();
    const g: any = newGame();
    g.inventory.wood = -3;
    expect(writeSlot(kv, g).ok).toBe(false);
    expect(kv.store[SLOT_KEY]).toBeUndefined();
  });

  it("reports quota errors instead of throwing", () => {
    const kv: KV = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(writeSlot(kv, newGame()).ok).toBe(false);
  });
});
