// Fixed game data for chapter 1: map layout, prices, costs and timings.
// Everything the rules need lives here so balancing happens in one file.

export const ITEM_IDS = ["wood", "stone", "seed_radish", "radish"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const ITEM_NAMES: Record<ItemId, string> = {
  wood: "ไม้",
  stone: "หิน",
  seed_radish: "เมล็ดหัวไชเท้า",
  radish: "หัวไชเท้า",
};

export const TOOL_IDS = ["hand", "hoe", "can", "axe", "hammer", "seeds"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_NAMES: Record<ToolId, string> = {
  hand: "มือเปล่า",
  hoe: "จอบ",
  can: "บัวรดน้ำ",
  axe: "ขวาน",
  hammer: "ค้อน",
  seeds: "เมล็ด",
};

/** Stamina each tool swing costs. */
export const TOOL_STAMINA: Record<ToolId, number> = { hand: 0, hoe: 2, can: 1, axe: 3, hammer: 3, seeds: 0 };

export const STAMINA_MAX = 100;
export const CAN_MAX = 30;

// ---- time ----
export const DAY_START = 6 * 60; // 06:00, minutes since midnight
export const DAY_END = 24 * 60; // 24:00 = pass out
/** Real seconds per in-game minute. 1 game hour = 20 real seconds. */
export const REAL_SECONDS_PER_GAME_MINUTE = 20 / 60;
export const WEEKDAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

// ---- economy ----
export const START_MONEY = 50;
export const SEED_PRICE = 20;
export const RADISH_PRICE = 60;
export const START_SEEDS = 6;
export const RADISH_GROW_NIGHTS = 3; // watered nights from seed to ripe
export const REPAIR_COST = { wood: 30, stone: 15, money: 300 } as const;
export const FRIENDSHIP_MAX = 100;

// ---- field: 8 x 6 tiles of 1 x 1 units ----
export const FIELD = { x0: 3, z0: 0, cols: 8, rows: 6 } as const;
export const TILE_COUNT = FIELD.cols * FIELD.rows;

export function tileIndexAt(x: number, z: number): number {
  const c = Math.floor(x - FIELD.x0);
  const r = Math.floor(z - FIELD.z0);
  if (c < 0 || r < 0 || c >= FIELD.cols || r >= FIELD.rows) return -1;
  return r * FIELD.cols + c;
}

export function tileCenter(i: number): { x: number; z: number } {
  return { x: FIELD.x0 + (i % FIELD.cols) + 0.5, z: FIELD.z0 + Math.floor(i / FIELD.cols) + 0.5 };
}

// ---- debris: branches, stumps, rocks and boulders to clear for materials ----
export type DebrisKind = "branch" | "stump" | "rock" | "boulder";
export interface DebrisDef {
  kind: DebrisKind;
  x: number;
  z: number;
}
export const DEBRIS_INFO: Record<DebrisKind, { tool: ToolId; item: ItemId; amount: number; stamina: number; name: string; respawns: boolean }> = {
  branch: { tool: "axe", item: "wood", amount: 1, stamina: 3, name: "กิ่งไม้", respawns: true },
  stump: { tool: "axe", item: "wood", amount: 3, stamina: 6, name: "ตอไม้", respawns: false },
  rock: { tool: "hammer", item: "stone", amount: 1, stamina: 3, name: "ก้อนหิน", respawns: true },
  boulder: { tool: "hammer", item: "stone", amount: 3, stamina: 6, name: "หินก้อนใหญ่", respawns: false },
};

const d = (kind: DebrisKind, x: number, z: number): DebrisDef => ({ kind, x, z });
// Positions sit on tile centres (inside the field they block tilling until cleared).
export const DEBRIS: DebrisDef[] = [
  d("branch", 4.5, 1.5), d("branch", 7.5, 0.5), d("branch", 9.5, 3.5), d("branch", 5.5, 4.5),
  d("branch", 10.5, 5.5), d("branch", -2.5, 5.5), d("branch", -7.5, 6.5), d("branch", -9.5, 1.5),
  d("branch", 1.5, 7.5), d("branch", 11.5, -3.5), d("branch", -5.5, -7.5), d("branch", 8.5, -6.5),
  d("rock", 6.5, 2.5), d("rock", 8.5, 5.5), d("rock", 3.5, 3.5), d("rock", -4.5, 7.5),
  d("rock", -10.5, -4.5), d("rock", 10.5, -1.5),
  d("stump", -8.5, -5.5), d("stump", 11.5, 7.5), d("stump", -10.5, 4.5),
  d("boulder", 6.5, -7.5), d("boulder", -6.5, 7.5),
];

// ---- fixed props (collision boxes and interaction points) ----
export const HOUSE = { x: 0, z: -6, w: 6, d: 5 } as const;
export const DOOR = { x: 0, z: -3.3 } as const;
export const WORKBENCH = { x: -4.5, z: -3.2 } as const;
export const SHIPPING_BIN = { x: 4.2, z: -2.6 } as const;
export const WELL = { x: -5.5, z: 2.5 } as const;
export const SIGNPOST = { x: 15.5, z: 4 } as const;
export const VISITOR_SPOT = { x: 15, z: 1.2 } as const;
export const FARM_BOUNDS = { x0: -11.5, x1: 13, z0: -9.5, z1: 8.5 } as const;
export const ROAD = { x0: 13, x1: 21, z0: 0.5, z1: 3.5 } as const;

// Interior of the house is built past the edge of the farm ground in the same scene.
export const INTERIOR = { x: 0, z: 56, w: 8, d: 6 } as const;
export const INTERIOR_SPAWN = { x: 0, z: 58.4 } as const;
export const OUTSIDE_SPAWN = { x: 0, z: -2.6 } as const;
export const BED = { x: -2.8, z: 54 } as const;
export const CHEST = { x: 2.9, z: 53.8 } as const;

export const WORLD_HALF_SIZE = 64;

// Trees and other solid scenery (circle colliders, also used by the renderer).
export const TREES: { x: number; z: number; r: number }[] = [
  { x: -9, z: -2, r: 1.6 }, { x: -10, z: 7, r: 1.4 }, { x: 12, z: -8, r: 1.5 }, { x: -6, z: -8.5, r: 1.3 },
  { x: 7.5, z: 8, r: 1.4 }, { x: 18, z: -2.5, r: 1.6 }, { x: 19.5, z: 6, r: 1.4 }, { x: 15, z: 7.5, r: 1.2 },
];
export const LAMP = { x: 2.6, z: -2.8 } as const;
