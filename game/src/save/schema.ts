// Save data shape and validation. Story progress, item counts and world state
// are separate sections so a bad inventory value can never rewrite story state.

import {
  CAN_MAX,
  DAY_END,
  DAY_START,
  DEBRIS,
  FRIENDSHIP_MAX,
  ITEM_IDS,
  RADISH_GROW_NIGHTS,
  STAMINA_MAX,
  START_MONEY,
  START_SEEDS,
  TILE_COUNT,
  TOOL_IDS,
  WORLD_HALF_SIZE,
  type ItemId,
  type ToolId,
} from "../sim/data";

export const SAVE_VERSION = 2;

export const STORY_FLAGS = [
  "intro_done",
  "met_caretaker",
  "first_planted",
  "first_harvest",
  "first_shipped",
  "house_repaired",
  "met_visitor",
  "found_clue",
  "chapter_done",
] as const;
export type StoryFlag = (typeof STORY_FLAGS)[number];

export const ENDING_CHOICES = ["stay_and_rebuild", "follow_the_clue"] as const;
export type EndingChoice = (typeof ENDING_CHOICES)[number];

export const NPC_IDS = ["caretaker", "visitor", "dog"] as const;
export type NpcId = (typeof NPC_IDS)[number];

export const WEATHERS = ["sunny", "rain"] as const;
export type Weather = (typeof WEATHERS)[number];

export const LOCATIONS = ["farm", "house"] as const;
export type Location = (typeof LOCATIONS)[number];

export const LIMITS = {
  itemMax: 999,
  moneyMax: 999_999,
  dayMax: 999,
  statMax: 99_999_999,
} as const;

export interface TileState {
  tilled: boolean;
  watered: boolean;
  crop: "none" | "radish";
  growth: number; // 0..RADISH_GROW_NIGHTS; max = ripe
}

export interface SaveData {
  version: number;
  savedAt: string;
  story: {
    chapter: 1;
    flags: Record<StoryFlag, boolean>;
    choice: EndingChoice | null;
    friendship: Record<NpcId, number>;
    repairDay: number; // 0 = not repaired yet
  };
  inventory: Record<ItemId, number> & { money: number };
  world: {
    day: number;
    time: number; // minutes since midnight
    weather: Weather;
    stamina: number;
    location: Location;
    player: { x: number; z: number; facing: number };
    tool: ToolId;
    water: number;
    tiles: TileState[];
    debris: boolean[]; // true = still on the map
    shippingBin: number; // radishes waiting to be paid for overnight
    daily: Record<NpcId, boolean>; // talked / petted today
  };
  stats: { shipped: number; earned: number; playSeconds: number };
}

const flagsOff = () => Object.fromEntries(STORY_FLAGS.map((f) => [f, false])) as Record<StoryFlag, boolean>;
const npcZero = () => Object.fromEntries(NPC_IDS.map((n) => [n, 0])) as Record<NpcId, number>;
const npcFalse = () => Object.fromEntries(NPC_IDS.map((n) => [n, false])) as Record<NpcId, boolean>;

export function newGame(): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: new Date(0).toISOString(),
    story: { chapter: 1, flags: flagsOff(), choice: null, friendship: npcZero(), repairDay: 0 },
    inventory: { money: START_MONEY, wood: 0, stone: 0, seed_radish: START_SEEDS, radish: 0 },
    world: {
      day: 1,
      time: DAY_START,
      weather: "sunny",
      stamina: STAMINA_MAX,
      location: "farm",
      player: { x: 17, z: 2, facing: -Math.PI / 2 },
      tool: "hand",
      water: CAN_MAX,
      tiles: Array.from({ length: TILE_COUNT }, () => ({ tilled: false, watered: false, crop: "none", growth: 0 })),
      debris: DEBRIS.map(() => true),
      shippingBin: 0,
      daily: npcFalse(),
    },
    stats: { shipped: 0, earned: 0, playSeconds: 0 },
  };
}

export type ValidationResult = { ok: true; data: SaveData } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

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
    else for (const f of STORY_FLAGS) if (!isBool(story.flags[f])) err(`story.flags.${f}`, "not boolean");
    if (story.choice !== null && !oneOf(story.choice, ENDING_CHOICES)) err("story.choice", "unknown choice");
    if (!isObj(story.friendship)) err("story.friendship", "not an object");
    else for (const n of NPC_IDS) if (!isInt(story.friendship[n], 0, FRIENDSHIP_MAX)) err(`story.friendship.${n}`, "out of range");
    if (!isInt(story.repairDay, 0, LIMITS.dayMax)) err("story.repairDay", "out of range");
  }

  const inv = raw.inventory;
  if (!isObj(inv)) err("inventory", "not an object");
  else {
    if (!isInt(inv.money, 0, LIMITS.moneyMax)) err("inventory.money", `not an integer 0..${LIMITS.moneyMax}`);
    for (const i of ITEM_IDS) if (!isInt(inv[i], 0, LIMITS.itemMax)) err(`inventory.${i}`, `not an integer 0..${LIMITS.itemMax}`);
  }

  const w = raw.world;
  if (!isObj(w)) err("world", "not an object");
  else {
    if (!isInt(w.day, 1, LIMITS.dayMax)) err("world.day", `not an integer 1..${LIMITS.dayMax}`);
    if (!isNum(w.time, DAY_START, DAY_END)) err("world.time", "out of range");
    if (!oneOf(w.weather, WEATHERS)) err("world.weather", "unknown");
    if (!isNum(w.stamina, 0, STAMINA_MAX)) err("world.stamina", "out of range");
    if (!oneOf(w.location, LOCATIONS)) err("world.location", "unknown");
    const p = w.player;
    const h = WORLD_HALF_SIZE;
    if (!isObj(p) || !isNum(p.x, -h, h) || !isNum(p.z, -h, h) || !isNum(p.facing, -100, 100)) err("world.player", "bad position");
    if (!oneOf(w.tool, TOOL_IDS)) err("world.tool", "unknown");
    if (!isInt(w.water, 0, CAN_MAX)) err("world.water", "out of range");
    if (!Array.isArray(w.tiles) || w.tiles.length !== TILE_COUNT) err("world.tiles", "wrong length");
    else
      w.tiles.forEach((t: unknown, i: number) => {
        if (
          !isObj(t) ||
          !isBool(t.tilled) ||
          !isBool(t.watered) ||
          !oneOf(t.crop, ["none", "radish"] as const) ||
          !isInt(t.growth, 0, RADISH_GROW_NIGHTS) ||
          (t.crop !== "none" && !t.tilled)
        )
          err(`world.tiles[${i}]`, "bad tile");
      });
    if (!Array.isArray(w.debris) || w.debris.length !== DEBRIS.length || !w.debris.every(isBool)) err("world.debris", "bad list");
    if (!isInt(w.shippingBin, 0, LIMITS.itemMax)) err("world.shippingBin", "out of range");
    if (!isObj(w.daily) || !NPC_IDS.every((n) => isBool((w.daily as Record<string, unknown>)[n]))) err("world.daily", "bad");
  }

  const s = raw.stats;
  if (!isObj(s) || !isInt(s.shipped, 0, LIMITS.statMax) || !isInt(s.earned, 0, LIMITS.statMax) || !isNum(s.playSeconds, 0, LIMITS.statMax))
    err("stats", "bad stats");

  return errors.length ? { ok: false, errors } : { ok: true, data: raw as unknown as SaveData };
}

/**
 * Upgrades older save formats. v1 (the scaffold prototype) kept items, day,
 * position and a few story flags; the field layout changed, so it restarts.
 * Returns the input unchanged when no migration applies.
 */
export function migrate(raw: unknown): unknown {
  if (!isObj(raw) || raw.version !== 1) return raw;
  const g = newGame();
  const inv = isObj(raw.inventory) ? raw.inventory : {};
  const take = (v: unknown) => (isInt(v, 0, LIMITS.itemMax) ? v : 0);
  g.inventory.wood = take(inv.wood);
  g.inventory.stone = take(inv.stone);
  const story = isObj(raw.story) && isObj(raw.story.flags) ? raw.story.flags : {};
  g.story.flags.intro_done = story.intro_done === true;
  g.story.flags.met_caretaker = story.met_caretaker === true;
  const w = isObj(raw.world) ? raw.world : {};
  if (isInt(w.day, 1, LIMITS.dayMax)) g.world.day = w.day;
  g.savedAt = typeof raw.savedAt === "string" ? raw.savedAt : g.savedAt;
  return g;
}
