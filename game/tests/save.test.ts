import { describe, expect, it } from "vitest";
import { LIMITS, newGame, validateSave } from "../src/save/schema";
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
    ["fractional count", (s: any) => (s.inventory.seed_cabbage = 1.5)],
    ["NaN day (serialised as null)", (s: any) => (s.world.day = null)],
    ["day zero", (s: any) => (s.world.day = 0)],
    ["missing story flag", (s: any) => delete s.story.flags.met_caretaker],
    ["flag not boolean", (s: any) => (s.story.flags.found_clue = "yes")],
    ["unknown choice", (s: any) => (s.story.choice = "sell_house")],
    ["player off map", (s: any) => (s.world.player.x = 1e9)],
    ["plot growth too high", (s: any) => (s.world.plots[0].growth = 9)],
    ["too few plots", (s: any) => s.world.plots.pop()],
    ["future version", (s: any) => (s.version = 99)],
  ])("rejects %s", (_name, mutate) => {
    const s = clone(newGame());
    mutate(s);
    expect(validateSave(s).ok).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const v of [null, 1, "x", [], undefined]) expect(validateSave(v).ok).toBe(false);
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
    const r = writeSlot(kv, newGame());
    expect(r.ok).toBe(false);
  });
});
