// Save data shape and validation. Story progress and item counts are kept in
// separate sections so a bad inventory value can never rewrite story state.

export const SAVE_VERSION = 1;

export const ITEM_IDS = ["wood", "stone", "seed_cabbage", "cabbage", "water"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const STORY_FLAGS = [
  "intro_done",
  "met_caretaker",
  "house_repaired",
  "met_visitor",
  "found_clue",
] as const;
export type StoryFlag = (typeof STORY_FLAGS)[number];

export const ENDING_CHOICES = ["stay_and_rebuild", "follow_the_clue"] as const;
export type EndingChoice = (typeof ENDING_CHOICES)[number];

export const LIMITS = {
  itemMax: 999,
  dayMax: 999,
  plotCount: 6,
  growthMax: 3,
  worldHalfSize: 64,
} as const;

export interface PlotState {
  crop: "none" | "cabbage";
  growth: number; // 0..growthMax; growthMax = ready to harvest
  watered: boolean;
}

export interface SaveData {
  version: number;
  savedAt: string; // ISO timestamp
  story: {
    chapter: 1;
    flags: Record<StoryFlag, boolean>;
    choice: EndingChoice | null;
  };
  inventory: Record<ItemId, number>;
  world: {
    day: number;
    player: { x: number; z: number; facing: number };
    plots: PlotState[];
  };
}

export function newGame(): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    story: {
      chapter: 1,
      flags: Object.fromEntries(STORY_FLAGS.map((f) => [f, false])) as Record<StoryFlag, boolean>,
      choice: null,
    },
    inventory: Object.fromEntries(ITEM_IDS.map((i) => [i, 0])) as Record<ItemId, number>,
    world: {
      day: 1,
      player: { x: 0, z: 6, facing: Math.PI },
      plots: Array.from({ length: LIMITS.plotCount }, () => ({ crop: "none", growth: 0, watered: false })),
    },
  };
}

export type ValidationResult = { ok: true; data: SaveData } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/**
 * Strictly validates parsed JSON. Never "repairs" bad values silently: any
 * wrong type or out-of-range number makes the whole save invalid, so the
 * caller can tell the player instead of loading half-broken state.
 */
export function validateSave(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(raw)) return { ok: false, errors: ["root: not an object"] };
  if (raw.version !== SAVE_VERSION) err("version", `expected ${SAVE_VERSION}, got ${String(raw.version)}`);
  if (typeof raw.savedAt !== "string" || Number.isNaN(Date.parse(raw.savedAt))) err("savedAt", "not a date");

  const story = raw.story;
  if (!isObj(story)) err("story", "not an object");
  else {
    if (story.chapter !== 1) err("story.chapter", "unknown chapter");
    if (!isObj(story.flags)) err("story.flags", "not an object");
    else for (const f of STORY_FLAGS) if (typeof story.flags[f] !== "boolean") err(`story.flags.${f}`, "not boolean");
    if (story.choice !== null && !ENDING_CHOICES.includes(story.choice as EndingChoice))
      err("story.choice", "unknown choice");
  }

  const inv = raw.inventory;
  if (!isObj(inv)) err("inventory", "not an object");
  else for (const i of ITEM_IDS) if (!isInt(inv[i], 0, LIMITS.itemMax)) err(`inventory.${i}`, `not an integer 0..${LIMITS.itemMax}`);

  const world = raw.world;
  if (!isObj(world)) err("world", "not an object");
  else {
    if (!isInt(world.day, 1, LIMITS.dayMax)) err("world.day", `not an integer 1..${LIMITS.dayMax}`);
    const p = world.player;
    const h = LIMITS.worldHalfSize;
    if (!isObj(p) || !isNum(p.x, -h, h) || !isNum(p.z, -h, h) || !isNum(p.facing, -100, 100))
      err("world.player", "bad position");
    if (!Array.isArray(world.plots) || world.plots.length !== LIMITS.plotCount) err("world.plots", "wrong length");
    else
      world.plots.forEach((pl: unknown, idx: number) => {
        if (
          !isObj(pl) ||
          (pl.crop !== "none" && pl.crop !== "cabbage") ||
          !isInt(pl.growth, 0, LIMITS.growthMax) ||
          typeof pl.watered !== "boolean"
        )
          err(`world.plots[${idx}]`, "bad plot");
      });
  }

  return errors.length ? { ok: false, errors } : { ok: true, data: raw as unknown as SaveData };
}
