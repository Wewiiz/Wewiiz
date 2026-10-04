// Chapter 1 rules: time, weather, stamina, tools, farming, shipping, house
// repair, NPC schedules, dialogue and the ending choice. Pure logic with no
// rendering, so the whole chapter can be played through in unit tests.

import {
  BED,
  CAN_MAX,
  CHEST,
  DAY_END,
  DAY_START,
  DEBRIS,
  DEBRIS_INFO,
  DOOR,
  FARM_BOUNDS,
  FRIENDSHIP_MAX,
  INTERIOR,
  INTERIOR_SPAWN,
  ITEM_NAMES,
  OUTSIDE_SPAWN,
  RADISH_GROW_NIGHTS,
  RADISH_PRICE,
  REAL_SECONDS_PER_GAME_MINUTE,
  REPAIR_COST,
  ROAD,
  SEED_PRICE,
  SHIPPING_BIN,
  SIGNPOST,
  STAMINA_MAX,
  HOUSE,
  TOOL_IDS,
  TOOL_NAMES,
  TOOL_STAMINA,
  TREES,
  VISITOR_SPOT,
  WEEKDAYS,
  WELL,
  WORKBENCH,
  LAMP,
  WORLD_HALF_SIZE,
  tileIndexAt,
  type ToolId,
} from "./data";
import { LIMITS, type EndingChoice, type NpcId, type SaveData, type Weather } from "../save/schema";

export interface Line {
  who?: string;
  text: string;
}
export interface Dialogue {
  lines: Line[];
  choices?: { label: string; pick: () => Dialogue | null }[];
}

export type GameEvent =
  | { type: "toast"; text: string; error?: boolean }
  | { type: "sfx"; name: Sfx }
  | { type: "dialogue"; dialogue: Dialogue }
  | { type: "fade"; text: string }
  | { type: "autosave" }
  | { type: "ending"; choice: EndingChoice }
  | { type: "teleport" };

export type Sfx = "hoe" | "water" | "chop" | "rock" | "plant" | "harvest" | "coin" | "blip" | "sleep" | "deny" | "door" | "bark";

export interface Vec2 {
  x: number;
  z: number;
}

const PLAYER_R = 0.35;
const N = { caretaker: "ป้าบุญ", visitor: "นิด", dog: "เจ้าโบ้", letter: "จดหมายของคุณตา" } as const;

function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32;
}

/** Weather is fixed per day so a reload cannot reroll it. Day 3 always rains to teach that rain waters crops. */
export function weatherFor(day: number): Weather {
  if (day <= 2) return "sunny";
  if (day === 3) return "rain";
  return hash(day * 97 + 13) < 0.25 ? "rain" : "sunny";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export class Game {
  events: GameEvent[] = [];
  /** Runtime-only dog position (not saved: it just wanders). */
  dog: Vec2 & { tx: number; tz: number; wait: number } = { x: -1, z: 1.5, tx: -1, tz: 1.5, wait: 0 };

  constructor(public state: SaveData) {}

  private emit(e: GameEvent) {
    this.events.push(e);
  }
  private toast(text: string, error = false) {
    this.emit({ type: "toast", text, error });
  }
  private sfx(name: Sfx) {
    this.emit({ type: "sfx", name });
  }
  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get w() {
    return this.state.world;
  }
  get flags() {
    return this.state.story.flags;
  }

  // ------------------------------------------------------------------ time
  /** Advances the clock by real seconds. Only called while the player is in control. */
  tick(realDt: number) {
    this.w.time = Math.min(DAY_END, this.w.time + realDt / REAL_SECONDS_PER_GAME_MINUTE);
    this.updateDog(realDt);
    if (this.w.time >= DAY_END) {
      this.toast("ดึกเกินไปจนหมดแรงหลับไป... พรุ่งนี้จะเหนื่อยกว่าปกติ", true);
      this.sleep(true);
    }
  }

  clockText(): string {
    const t = Math.floor(this.w.time);
    const h = Math.floor(t / 60);
    const m = Math.floor((t % 60) / 10) * 10;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  dateText(): string {
    return `ต้นฤดูฝน วันที่ ${this.w.day} (${WEEKDAYS[(this.w.day - 1) % 7]})`;
  }
  /** 0 at noon .. 1 at midnight; drives lighting. */
  darkness(): number {
    const t = this.w.time;
    if (t < 17 * 60) return 0;
    return clamp((t - 17 * 60) / (3 * 60), 0, 1);
  }

  // -------------------------------------------------------------- objective
  objective(): string {
    const f = this.flags;
    const inv = this.state.inventory;
    if (!f.met_caretaker) return "เดินเข้าไร่ แล้วคุยกับป้าบุญที่หน้าประตูรั้ว (กด E)";
    if (!f.first_planted) return "เลือกจอบ (2) พรวนดินในแปลง แล้วเลือกเมล็ด (6) หว่านลงดินที่พรวนแล้ว";
    if (!f.house_repaired) {
      const need = `ไม้ ${inv.wood}/${REPAIR_COST.wood} · หิน ${inv.stone}/${REPAIR_COST.stone} · เงิน ${inv.money}/${REPAIR_COST.money}`;
      if (inv.radish > 0) return `นำหัวไชเท้าไปใส่กล่องส่งขายข้างบ้าน · ${need}`;
      if (!f.first_harvest) return `รดน้ำผักทุกวันจนโต ระหว่างนั้นเก็บไม้และหินเพื่อซ่อมบ้าน · ${need}`;
      if (this.canRepair()) return "ของครบแล้ว! ไปที่โต๊ะช่างข้างบ้านเพื่อซ่อมบ้าน";
      return `เก็บของให้ครบแล้วซ่อมบ้านที่โต๊ะช่าง · ${need}`;
    }
    if (!f.met_visitor) {
      if (this.w.day <= this.state.story.repairDay) return "บ้านซ่อมเสร็จแล้ว เข้าไปดูในบ้าน แล้วนอนพักที่ฟูก";
      return "มีคนมายืนที่ทางเข้าหมู่บ้านทางทิศตะวันออก ลองไปทักทาย";
    }
    if (!f.found_clue) return "เปิดหีบของคุณตาในบ้าน ตามที่นิดบอก";
    if (!this.state.story.choice) return "นำสิ่งที่พบไปคุยกับนิดที่ทางเข้าหมู่บ้าน";
    return "จบบทที่ 1 แล้ว · ใช้ชีวิตในไร่ต่อได้ตามสบาย";
  }

  canRepair(): boolean {
    const i = this.state.inventory;
    return i.wood >= REPAIR_COST.wood && i.stone >= REPAIR_COST.stone && i.money >= REPAIR_COST.money;
  }

  // ------------------------------------------------------------- positions
  caretakerPos(): Vec2 | null {
    if (this.w.location !== "farm") return null;
    if (!this.flags.met_caretaker) return { x: 11.6, z: 2.2 };
    const t = this.w.time;
    if (t >= 17 * 60) return null; // gone home for the evening
    if (this.w.weather === "rain") return { x: -2.2, z: -3.0 }; // shelters under the eaves
    return t < 12 * 60 ? { x: 1.6, z: 1.6 } : { x: 2.4, z: -1.4 };
  }

  visitorPos(): Vec2 | null {
    if (this.w.location !== "farm") return null;
    const s = this.state.story;
    if (!s.flags.house_repaired || this.w.day <= s.repairDay) return null;
    if (s.choice === "follow_the_clue") return null; // left for the hills
    if (s.choice === "stay_and_rebuild") return this.w.time < 19 * 60 ? { x: -1.8, z: -1.6 } : null;
    if (this.w.time < 7 * 60 || this.w.time >= 19 * 60) return null;
    return { ...VISITOR_SPOT };
  }

  dogPos(): Vec2 | null {
    return this.w.location === "farm" ? this.dog : null;
  }

  private updateDog(dt: number) {
    const d = this.dog;
    if (d.wait > 0) {
      d.wait -= dt;
      return;
    }
    const dx = d.tx - d.x;
    const dz = d.tz - d.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) {
      d.wait = 1 + Math.random() * 3;
      d.tx = -3 + Math.random() * 5;
      d.tz = -1 + Math.random() * 5;
      return;
    }
    const step = Math.min(len, 1.6 * dt);
    d.x += (dx / len) * step;
    d.z += (dz / len) * step;
  }

  // ------------------------------------------------------------- movement
  private blocked(x: number, z: number): boolean {
    const r = PLAYER_R;
    if (this.w.location === "house") {
      const hx = INTERIOR.w / 2 - r;
      const hz = INTERIOR.d / 2 - r;
      if (Math.abs(x - INTERIOR.x) > hx || z < INTERIOR.z - hz || z > INTERIOR.z + INTERIOR.d / 2 + 0.6) return true;
      if (z > INTERIOR.z + hz && Math.abs(x - INTERIOR.x) > 0.7) return true; // only the doorway is open
      const furniture = [
        { x: BED.x, z: BED.z, hw: 0.9, hd: 1.3 },
        { x: CHEST.x, z: CHEST.z, hw: 0.7, hd: 0.5 },
        { x: INTERIOR.x, z: INTERIOR.z - 0.3, hw: 0.8, hd: 0.6 },
      ];
      return furniture.some((f) => Math.abs(x - f.x) < f.hw + r && Math.abs(z - f.z) < f.hd + r);
    }
    const inFarm = x > FARM_BOUNDS.x0 + r && x < FARM_BOUNDS.x1 && z > FARM_BOUNDS.z0 + r && z < FARM_BOUNDS.z1 - r;
    const inRoad = x >= FARM_BOUNDS.x1 - 1 && x < ROAD.x1 - r && z > ROAD.z0 + r && z < ROAD.z1 - r;
    if (!inFarm && !inRoad) return true;
    const boxes = [
      { x: HOUSE.x, z: HOUSE.z, hw: HOUSE.w / 2, hd: HOUSE.d / 2 },
      { x: WORKBENCH.x, z: WORKBENCH.z, hw: 0.8, hd: 0.45 },
      { x: SHIPPING_BIN.x, z: SHIPPING_BIN.z, hw: 0.6, hd: 0.45 },
      { x: SIGNPOST.x, z: SIGNPOST.z, hw: 0.15, hd: 0.15 },
      { x: LAMP.x, z: LAMP.z, hw: 0.15, hd: 0.15 },
    ];
    if (boxes.some((b) => Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r)) return true;
    const circles: { x: number; z: number; r: number }[] = [
      { x: WELL.x, z: WELL.z, r: 0.8 },
      ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.45 })),
      ...DEBRIS.filter((_, i) => this.w.debris[i]).map((d) => ({ x: d.x, z: d.z, r: d.kind === "stump" || d.kind === "boulder" ? 0.5 : 0.3 })),
    ];
    for (const npc of [this.caretakerPos(), this.visitorPos()]) if (npc) circles.push({ ...npc, r: 0.35 });
    return circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);
  }

  /** Moves with axis-separated sliding collision; handles door transitions. */
  move(dx: number, dz: number) {
    const p = this.w.player;
    if (dx === 0 && dz === 0) return;
    p.facing = Math.atan2(dx, dz);
    if (!this.blocked(p.x + dx, p.z)) p.x += dx;
    if (!this.blocked(p.x, p.z + dz)) p.z += dz;
    const lim = WORLD_HALF_SIZE - 1;
    p.x = clamp(p.x, -lim, lim);
    p.z = clamp(p.z, -lim, lim);

    if (this.w.location === "farm" && Math.abs(p.x - DOOR.x) < 0.8 && p.z < DOOR.z + 0.25 && dz < 0) this.enterHouse();
    else if (this.w.location === "house" && p.z > INTERIOR.z + INTERIOR.d / 2 + 0.2) this.leaveHouse();
  }

  enterHouse() {
    this.w.location = "house";
    Object.assign(this.w.player, { ...INTERIOR_SPAWN, facing: Math.PI });
    this.sfx("door");
    this.emit({ type: "teleport" });
    if (!this.flags.house_repaired) this.toast("ในบ้านมืดและเต็มไปด้วยฝุ่น หลังคารั่วหลายจุด");
  }

  leaveHouse() {
    this.w.location = "farm";
    Object.assign(this.w.player, { ...OUTSIDE_SPAWN, facing: 0 });
    this.sfx("door");
    this.emit({ type: "teleport" });
  }

  /** Point one step in front of the player, used for tool and talk targets. */
  front(reach = 0.9): Vec2 {
    const p = this.w.player;
    return { x: p.x + Math.sin(p.facing) * reach, z: p.z + Math.cos(p.facing) * reach };
  }

  /** The field tile the current tool would act on, or -1. */
  targetTile(): number {
    if (this.w.location !== "farm") return -1;
    const f = this.front();
    return tileIndexAt(f.x, f.z);
  }

  // ---------------------------------------------------------------- tools
  selectTool(t: ToolId) {
    this.w.tool = t;
  }
  cycleTool(step: number) {
    const i = TOOL_IDS.indexOf(this.w.tool);
    this.w.tool = TOOL_IDS[(i + step + TOOL_IDS.length) % TOOL_IDS.length];
  }

  private debrisAt(p: Vec2): number {
    let best = -1;
    let bestD = 0.85;
    DEBRIS.forEach((d, i) => {
      if (!this.w.debris[i]) return;
      const dd = dist(d, p);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  private spend(cost: number): boolean {
    if (this.w.stamina < cost) {
      this.toast("เหนื่อยเกินไปแล้ว กลับไปนอนพักในบ้านก่อนดีกว่า", true);
      this.sfx("deny");
      return false;
    }
    this.w.stamina = clamp(this.w.stamina - cost, 0, STAMINA_MAX);
    this.w.time = Math.min(DAY_END, this.w.time + 2); // every swing takes a little time
    return true;
  }

  private addItem(id: keyof typeof ITEM_NAMES, n: number) {
    const inv = this.state.inventory;
    const room = LIMITS.itemMax - inv[id];
    if (room <= 0) {
      this.toast(`${ITEM_NAMES[id]}เต็มกระเป๋าแล้ว`, true);
      return 0;
    }
    const got = Math.min(room, n);
    inv[id] += got;
    return got;
  }

  useTool() {
    const tool = this.w.tool;
    if (this.w.location !== "farm") {
      if (tool !== "hand") this.toast("ใช้เครื่องมือในบ้านไม่ได้");
      else this.interact();
      return;
    }
    if (tool === "hand") return this.interact();
    if (!this.flags.met_caretaker) {
      this.toast("ยังไม่มีเครื่องมือ ลองคุยกับป้าบุญก่อน", true);
      return;
    }
    const target = this.front();
    const ti = tileIndexAt(target.x, target.z);
    const tile = ti >= 0 ? this.w.tiles[ti] : null;

    switch (tool) {
      case "hoe": {
        if (!tile) return this.toast("ใช้จอบได้เฉพาะในแปลงผัก (พื้นที่ดินสีน้ำตาลด้านขวาบ้าน)");
        if (this.debrisAt(target) >= 0) return this.toast("มีของขวางอยู่ เก็บออกก่อนด้วยขวานหรือค้อน");
        if (tile.tilled) return this.toast("ดินตรงนี้พรวนแล้ว");
        if (!this.spend(TOOL_STAMINA.hoe)) return;
        tile.tilled = true;
        tile.watered = this.w.weather === "rain";
        this.sfx("hoe");
        return;
      }
      case "can": {
        if (dist(target, WELL) < 1.4 || dist(this.w.player, WELL) < 1.5) {
          this.w.water = CAN_MAX;
          this.sfx("water");
          return this.toast("เติมน้ำในบัวรดน้ำเต็มแล้ว");
        }
        if (!tile || !tile.tilled) return this.toast("รดน้ำได้เฉพาะดินที่พรวนแล้ว");
        if (this.w.water <= 0) return this.toast("น้ำหมด ไปเติมที่บ่อน้ำทางซ้ายของไร่", true);
        if (tile.watered) return this.toast("ตรงนี้รดน้ำแล้ว");
        if (!this.spend(TOOL_STAMINA.can)) return;
        this.w.water--;
        tile.watered = true;
        this.sfx("water");
        return;
      }
      case "seeds": {
        if (this.state.inventory.seed_radish <= 0) return this.toast("เมล็ดหมดแล้ว ซื้อเพิ่มได้จากป้าบุญ", true);
        if (!tile || !tile.tilled) return this.toast("ต้องหว่านเมล็ดบนดินที่พรวนแล้ว");
        if (tile.crop !== "none") return this.toast("ตรงนี้ปลูกไว้แล้ว");
        this.state.inventory.seed_radish--;
        tile.crop = "radish";
        tile.growth = 0;
        this.sfx("plant");
        if (!this.flags.first_planted) {
          this.flags.first_planted = true;
          this.toast("ปลูกต้นแรกแล้ว! อย่าลืมรดน้ำทุกวัน ผักจะโตตอนเรานอน");
        }
        return;
      }
      case "axe":
      case "hammer": {
        const di = this.debrisAt(target);
        if (di < 0) return this.toast(tool === "axe" ? "ไม่มีกิ่งไม้หรือตอไม้ตรงหน้า" : "ไม่มีก้อนหินตรงหน้า");
        const info = DEBRIS_INFO[DEBRIS[di].kind];
        if (info.tool !== tool) return this.toast(`${info.name}ต้องใช้${TOOL_NAMES[info.tool]}`);
        if (!this.spend(info.stamina)) return;
        this.w.debris[di] = false;
        const got = this.addItem(info.item, info.amount);
        this.sfx(tool === "axe" ? "chop" : "rock");
        if (got) this.toast(`ได้${ITEM_NAMES[info.item]} +${got}`);
        return;
      }
    }
  }

  // ------------------------------------------------------------ interaction
  /** E key: talk, check, harvest, open. Picks the closest thing in front. */
  interact() {
    const f = this.front(1.0);
    const near = (p: Vec2 | null, r = 1.3) => p !== null && (dist(p, f) < r || dist(p, this.w.player) < r * 0.8);

    if (this.w.location === "house") {
      if (near(BED, 1.8)) return this.bedDialogue();
      if (near(CHEST, 1.4)) return this.chestDialogue();
      return this.toast("ไม่มีอะไรให้ตรวจดูตรงนี้");
    }

    if (near(this.caretakerPos())) return this.talkCaretaker();
    if (near(this.visitorPos())) return this.talkVisitor();
    if (near(this.dogPos(), 1.1)) return this.petDog();

    const ti = this.targetTile();
    if (ti >= 0) {
      const t = this.w.tiles[ti];
      if (t.crop === "radish" && t.growth >= RADISH_GROW_NIGHTS) return this.harvest(ti);
      if (t.crop === "radish") {
        const left = RADISH_GROW_NIGHTS - t.growth;
        return this.toast(`หัวไชเท้ายังไม่โต อีก ${left} คืนที่รดน้ำแล้ว${t.watered ? " (วันนี้รดน้ำแล้ว)" : " (วันนี้ยังไม่ได้รดน้ำ)"}`);
      }
    }
    if (near(SHIPPING_BIN, 1.4)) return this.shipDialogue();
    if (near(WORKBENCH, 1.4)) return this.workbenchDialogue();
    if (near(WELL, 1.6)) {
      if (!this.flags.met_caretaker) return this.toast("บ่อน้ำเก่า น้ำยังใสอยู่");
      this.w.water = CAN_MAX;
      this.sfx("water");
      return this.toast("เติมน้ำในบัวรดน้ำเต็มแล้ว");
    }
    if (near(SIGNPOST, 1.4)) return this.signDialogue();
    const di = this.debrisAt(f);
    if (di >= 0) {
      const info = DEBRIS_INFO[DEBRIS[di].kind];
      return this.toast(`${info.name} · ใช้${TOOL_NAMES[info.tool]}เพื่อเก็บ`);
    }
    this.toast("ไม่มีอะไรให้ตรวจดูตรงนี้");
  }

  private say(dialogue: Dialogue) {
    this.sfx("blip");
    this.emit({ type: "dialogue", dialogue });
  }

  private befriend(npc: NpcId, amount: number) {
    const fr = this.state.story.friendship;
    fr[npc] = clamp(fr[npc] + amount, 0, FRIENDSHIP_MAX);
  }

  harvest(ti: number) {
    const t = this.w.tiles[ti];
    if (this.addItem("radish", 1) === 0) return;
    t.crop = "none";
    t.growth = 0;
    this.sfx("harvest");
    if (!this.flags.first_harvest) {
      this.flags.first_harvest = true;
      this.toast("เก็บเกี่ยวครั้งแรก! นำไปใส่กล่องส่งขายข้างบ้านได้");
    } else this.toast("ได้หัวไชเท้า +1");
  }

  shipDialogue() {
    const n = this.state.inventory.radish;
    const waiting = this.w.shippingBin;
    if (n === 0)
      return this.say({
        lines: [{ text: waiting ? `ในกล่องมีหัวไชเท้ารอส่งขาย ${waiting} หัว คนรับซื้อจะมาเก็บตอนกลางคืน` : "กล่องส่งขาย ใส่ผลผลิตไว้ คนรับซื้อจากตลาดจะมาเก็บทุกคืน แล้วฝากเงินไว้ให้ตอนเช้า" }],
      });
    this.say({
      lines: [{ text: `ใส่หัวไชเท้า ${n} หัวลงกล่องส่งขายไหม? (หัวละ ${RADISH_PRICE} เหรียญ ได้เงินพรุ่งนี้เช้า)` }],
      choices: [
        {
          label: "ใส่ทั้งหมด",
          pick: () => {
            this.state.inventory.radish = 0;
            this.w.shippingBin = Math.min(LIMITS.itemMax, this.w.shippingBin + n);
            this.flags.first_shipped = true;
            this.sfx("coin");
            return { lines: [{ text: `ใส่แล้ว ${n} หัว จะได้ ${n * RADISH_PRICE} เหรียญพรุ่งนี้เช้า` }] };
          },
        },
        { label: "ยังก่อน", pick: () => null },
      ],
    });
  }

  workbenchDialogue() {
    if (this.flags.house_repaired)
      return this.say({ lines: [{ text: "โต๊ะช่างของคุณตา ตอนนี้บ้านแข็งแรงดีแล้ว เครื่องมือถูกเก็บเข้าที่เรียบร้อย" }] });
    const inv = this.state.inventory;
    const need = `ไม้ ${inv.wood}/${REPAIR_COST.wood}  หิน ${inv.stone}/${REPAIR_COST.stone}  เงิน ${inv.money}/${REPAIR_COST.money} (ค่าตะปูและกระเบื้อง)`;
    if (!this.canRepair())
      return this.say({ lines: [{ text: "โต๊ะช่างเก่าของคุณตา มีแบบร่างการซ่อมบ้านวางอยู่" }, { text: `ของที่ต้องใช้: ${need}` }] });
    this.say({
      lines: [{ text: `ของครบแล้ว! ${need}` }, { text: "จะเริ่มซ่อมบ้านเลยไหม? (ใช้เวลาจนถึงเย็น)" }],
      choices: [
        { label: "ซ่อมเลย", pick: () => this.repairHouse() },
        { label: "ไว้ก่อน", pick: () => null },
      ],
    });
  }

  repairHouse(): Dialogue {
    const inv = this.state.inventory;
    inv.wood -= REPAIR_COST.wood;
    inv.stone -= REPAIR_COST.stone;
    inv.money -= REPAIR_COST.money;
    this.flags.house_repaired = true;
    this.state.story.repairDay = this.w.day;
    this.w.time = Math.max(this.w.time, 18 * 60);
    this.w.stamina = clamp(this.w.stamina - 20, 0, STAMINA_MAX);
    this.emit({ type: "fade", text: "ตอกตะปู เปลี่ยนไม้ผุ มุงกระเบื้องใหม่... ป้าบุญกับเพื่อนบ้านมาช่วยจนเย็น" });
    this.sfx("rock");
    return {
      lines: [
        { who: N.caretaker, text: "เสร็จแล้วจ้ะ! ดูสิ บ้านกลับมาสวยเหมือนตอนตาเขายังอยู่เลย" },
        { who: N.caretaker, text: "คืนนี้ไฟในบ้านจะสว่างเป็นครั้งแรกในรอบสิบปี คนในหมู่บ้านคงเห็นกันทั่ว" },
      ],
    };
  }

  signDialogue() {
    const c = this.state.story.choice;
    if (c === "follow_the_clue")
      return this.say({ lines: [{ text: "ป้ายไม้: ← ไร่คุณตา | หมู่บ้านดอยฝน → | ↑ ทางขึ้นห้วยเย็น (มีรอยเท้าใหม่สองคู่)" }] });
    this.say({ lines: [{ text: "ป้ายไม้: ← ไร่คุณตา | หมู่บ้านดอยฝน →" }, { text: "ทางไปหมู่บ้านยังรกอยู่ ไว้ค่อยไปเมื่อพร้อม" }] });
  }

  petDog() {
    this.sfx("bark");
    if (!this.w.daily.dog) {
      this.w.daily.dog = true;
      this.befriend("dog", 5);
    }
    const lines = ["เจ้าโบ้กระดิกหางแรงจนตัวโยก", "เจ้าโบ้นอนหงายท้องให้เกา", "เจ้าโบ้เห่าทักทายเสียงใส"];
    this.toast(lines[(this.w.day + this.state.story.friendship.dog) % lines.length]);
  }

  // ---------------------------------------------------------------- people
  talkCaretaker() {
    const f = this.flags;
    if (!f.met_caretaker) return this.say(this.caretakerIntro());
    const first = !this.w.daily.caretaker;
    if (first) {
      this.w.daily.caretaker = true;
      this.befriend("caretaker", 4);
    }
    this.say({ lines: [{ who: N.caretaker, text: this.caretakerSmallTalk() }], choices: this.caretakerMenu() });
  }

  private caretakerIntro(): Dialogue {
    return {
      lines: [
        { who: N.caretaker, text: "อ้าว! หลานตาเหมือนใช่ไหมจ๊ะ ป้าชื่อบุญ บ้านอยู่ถัดไปทางเนินนั่น" },
        { who: N.caretaker, text: "ตั้งแต่ตาเขาจากไป ป้าก็คอยแวะมาดูบ้านให้ แต่ป้าแก่แล้ว ซ่อมเองไม่ไหว" },
        { who: N.caretaker, text: `บ้านหลังคารั่ว ไม้ผุไปหลายแผ่น ต้องใช้ไม้ ${REPAIR_COST.wood} หิน ${REPAIR_COST.stone} กับเงินค่าตะปูและกระเบื้องอีก ${REPAIR_COST.money} เหรียญ` },
        { who: N.caretaker, text: "นี่ เครื่องมือของตาเขา ป้าเก็บไว้ให้ จอบ บัวรดน้ำ ขวาน ค้อน ครบเลย กับเมล็ดหัวไชเท้าอีก 6 ซอง" },
        { who: N.caretaker, text: "พรวนดินในแปลงด้วยจอบ หว่านเมล็ด แล้วรดน้ำทุกวัน นอนครบสามคืนก็เก็บได้ ถ้าฝนตกไม่ต้องรด" },
        { who: N.caretaker, text: "เก็บได้แล้วเอาไปใส่กล่องส่งขายข้างบ้าน คนรับซื้อมาเก็บตอนกลางคืน เช้ามาได้เงิน" },
        { who: N.caretaker, text: "กิ่งไม้ตัดด้วยขวาน ก้อนหินทุบด้วยค้อน กิ่งไม้กับหินจะมีมาเพิ่มทุกคืน ทำงานมากจะเหนื่อย ดูแถบแรงไว้ หมดแรงก็กลับไปนอนนะ" },
      ],
      choices: [
        {
          label: "ขอบคุณครับ/ค่ะ ป้าบุญ",
          pick: () => {
            this.flags.met_caretaker = true;
            this.w.daily.caretaker = true;
            this.befriend("caretaker", 10);
            this.w.tool = "hoe";
            this.sfx("coin");
            return { lines: [{ text: "ได้รับ จอบ บัวรดน้ำ ขวาน ค้อน และเมล็ดหัวไชเท้า 6 ซอง (กด 1-6 เพื่อเลือกเครื่องมือ)" }] };
          },
        },
      ],
    };
  }

  private caretakerSmallTalk(): string {
    const f = this.flags;
    const d = this.w.day;
    if (this.state.story.choice === "follow_the_clue") return "ขึ้นเขาไปตามหาห้วยเย็นเหรอ ระวังตัวด้วยนะ ป้าจะดูไร่ให้";
    if (this.state.story.choice === "stay_and_rebuild") return "เห็นนิดกลับมาอยู่ ป้าดีใจจริง ๆ หมู่บ้านเริ่มคึกคักขึ้นแล้วนะ";
    if (f.met_visitor) return "นิดกลับมาแล้วเหรอ เด็กคนนั้นเคยวิ่งเล่นในไร่นี้ทุกเย็นเลยนะ";
    if (f.house_repaired) return "บ้านดูอบอุ่นขึ้นเยอะเลย เมื่อคืนป้ามองจากเนินยังเห็นแสงไฟ";
    if (this.w.weather === "rain") return "ฝนตกแบบนี้ผักได้น้ำเต็มที่ วันนี้ไม่ต้องรดน้ำแล้วจ้ะ";
    if (f.first_shipped) return "ขายผักได้แล้วเหรอ เก่งจริง เก็บเงินไว้ซ่อมบ้านนะ";
    if (f.first_harvest) return "หัวไชเท้าสวยดีนะ เอาไปใส่กล่องส่งขายข้างบ้านได้เลย";
    if (f.first_planted) return d % 2 ? "อย่าลืมรดน้ำทุกแปลงนะ ผักไม่ได้น้ำจะไม่โต" : "เก็บไม้กับหินไว้ด้วยนะ ระหว่างรอผักโต";
    return "ลองใช้จอบพรวนดินในแปลงก่อนนะ แปลงอยู่ทางขวาของบ้าน";
  }

  private caretakerMenu(): Dialogue["choices"] {
    return [
      { label: `ซื้อเมล็ดหัวไชเท้า (ซองละ ${SEED_PRICE})`, pick: () => this.shopDialogue() },
      {
        label: "ถามเรื่องบ้าน",
        pick: () => ({
          lines: [
            {
              who: N.caretaker,
              text: this.flags.house_repaired
                ? "ตาเขาเคยบอกว่าบ้านหลังนี้คือหัวใจของหมู่บ้าน ถ้าไฟที่นี่ติด คนจะเริ่มกลับมา"
                : `ซ่อมได้ที่โต๊ะช่างข้างบ้าน ต้องมีไม้ ${REPAIR_COST.wood} หิน ${REPAIR_COST.stone} เงิน ${REPAIR_COST.money}`,
            },
          ],
        }),
      },
      { label: "ไว้คุยกันใหม่", pick: () => null },
    ];
  }

  private shopDialogue(): Dialogue {
    const buy = (n: number) => () => {
      const cost = n * SEED_PRICE;
      if (this.state.inventory.money < cost) return { lines: [{ who: N.caretaker, text: "เงินยังไม่พอจ้ะ ไว้ขายผักได้ก่อนค่อยมาซื้อ" }] };
      const got = this.addItem("seed_radish", n);
      this.state.inventory.money -= got * SEED_PRICE;
      this.sfx("coin");
      return { lines: [{ who: N.caretaker, text: `นี่จ้ะ เมล็ดหัวไชเท้า ${got} ซอง` }] };
    };
    return {
      lines: [{ who: N.caretaker, text: `จะเอากี่ซองจ๊ะ (มีเงิน ${this.state.inventory.money} เหรียญ)` }],
      choices: [
        { label: `1 ซอง (${SEED_PRICE})`, pick: buy(1) },
        { label: `5 ซอง (${SEED_PRICE * 5})`, pick: buy(5) },
        { label: "ไม่ซื้อแล้ว", pick: () => null },
      ],
    };
  }

  talkVisitor() {
    const f = this.flags;
    const s = this.state.story;
    if (!this.w.daily.visitor) {
      this.w.daily.visitor = true;
      this.befriend("visitor", 4);
    }
    if (!f.met_visitor) {
      return this.say({
        lines: [
          { who: N.visitor, text: "...เธอเองเหรอที่จุดไฟในบ้านคุณตาเมื่อคืน? ฉันนิด เคยอยู่บ้านติดกันตอนเด็ก ๆ" },
          { who: N.visitor, text: "ฉันไปทำงานในเมืองมาสิบปี กลับมาเยี่ยมแม่ เห็นแสงไฟจากบ้านหลังนี้ เลยอดเดินมาดูไม่ได้" },
          { who: N.visitor, text: "หมู่บ้านเงียบลงทุกปี ตั้งแต่ห้วยเย็นแห้ง ไร่ก็ร้าง คนหนุ่มสาวก็ย้ายออกไปหมด" },
          { who: N.visitor, text: "คุณตาเคยบอกว่ารู้สาเหตุว่าทำไมน้ำหาย ท่านเก็บอะไรไว้ในหีบไม้ในบ้านด้วย กดที่มุมฝาหีบจะเปิดออก" },
        ],
        choices: [
          {
            label: "เดี๋ยวจะไปเปิดดู",
            pick: () => {
              f.met_visitor = true;
              this.befriend("visitor", 10);
              return { lines: [{ who: N.visitor, text: "ฉันจะรออยู่ตรงนี้นะ ได้อะไรมาบอกด้วย" }] };
            },
          },
        ],
      });
    }
    if (!f.found_clue) return this.say({ lines: [{ who: N.visitor, text: "หีบอยู่มุมขวาในบ้าน ลองกดที่มุมฝาดูนะ" }] });
    if (!s.choice) return this.say(this.choiceDialogue());
    if (s.choice === "stay_and_rebuild")
      return this.say({ lines: [{ who: N.visitor, text: "พรุ่งนี้ฉันจะเอาเมล็ดผักจากบ้านแม่มาให้อีกนะ ไร่นี้ต้องเขียวทั้งแปลง!" }] });
    this.say({ lines: [{ who: N.visitor, text: "พร้อมเมื่อไหร่ก็ขึ้นเขากันเลย" }] });
  }

  private choiceDialogue(): Dialogue {
    return {
      lines: [
        { who: N.visitor, text: "แผนที่ของคุณตา! ห้วยเย็นไม่ได้แห้ง แต่ดินถล่มปิดทางน้ำไว้บนเขา..." },
        { who: N.visitor, text: "ถ้าเปิดทางน้ำได้ ไร่ทั้งหมู่บ้านจะกลับมามีชีวิต แต่ทางขึ้นเขาไกลและอันตราย" },
        { who: N.visitor, text: "เธอว่าเราควรทำยังไงดี?" },
      ],
      choices: [
        { label: "อยู่ฟื้นฟูไร่และบ้านให้มั่นคงก่อน", pick: () => this.choose("stay_and_rebuild") },
        { label: "ออกเดินทางตามหาห้วยเย็นด้วยกัน", pick: () => this.choose("follow_the_clue") },
      ],
    };
  }

  private choose(choice: EndingChoice): Dialogue {
    const s = this.state.story;
    s.choice = choice;
    s.flags.chapter_done = true;
    this.befriend("visitor", 10);
    if (choice === "stay_and_rebuild") {
      this.addItem("seed_radish", 5);
      this.emit({ type: "ending", choice });
      return {
        lines: [
          { who: N.visitor, text: "ใช่ ถ้าเราไม่มีบ้านที่มั่นคง ก็ไม่มีที่ให้ใครกลับมา" },
          { who: N.visitor, text: "ฉันจะอยู่ช่วยที่ไร่สักพัก เอาเมล็ดนี่ไปก่อน แม่ฝากมา (ได้เมล็ดหัวไชเท้า +5)" },
        ],
      };
    }
    this.emit({ type: "ending", choice });
    return {
      lines: [
        { who: N.visitor, text: "ฉันรู้ว่าเธอต้องพูดแบบนี้! คุณตาคงดีใจ" },
        { who: N.visitor, text: "พรุ่งนี้เช้าเจอกันที่ป้ายทางแยก เตรียมแรงไว้ให้ดีนะ" },
      ],
    };
  }

  private chestDialogue() {
    const f = this.flags;
    if (!f.house_repaired) return this.say({ lines: [{ text: "หีบไม้เก่าของคุณตา ฝาบวมน้ำจนติดแน่น หลังคารั่วตรงนี้พอดี" }] });
    if (!f.met_visitor) return this.say({ lines: [{ text: "หีบไม้ของคุณตา แห้งดีแล้วหลังซ่อมหลังคา แต่ยังหาทางเปิดไม่เจอ" }] });
    if (!f.found_clue) {
      f.found_clue = true;
      this.sfx("harvest");
      return this.say({
        lines: [
          { text: "กดที่มุมฝาหีบ... แกร๊ก! ฝาเด้งเปิดออก ข้างในมีจดหมายกับแผนที่วาดมือ" },
          { who: N.letter, text: "\"หลานรัก ถ้าได้อ่านจดหมายนี้ แปลว่าบ้านเรามีคนอยู่อีกครั้งแล้ว\"" },
          { who: N.letter, text: "\"ห้วยเย็นไม่ได้แห้งหาย ดินถล่มเมื่อสิบปีก่อนปิดทางน้ำไว้ที่ผาหินบนเขา ตาทำเครื่องหมายไว้ในแผนที่\"" },
          { who: N.letter, text: "\"ตาแก่เกินจะขึ้นไปแล้ว ถ้าวันหนึ่งน้ำกลับมา ไร่ทุกแปลงในดอยฝนจะเขียวอีกครั้ง\"" },
          { text: "ได้รับ: แผนที่ห้วยเย็น · ลองนำไปให้นิดดู" },
        ],
      });
    }
    this.say({ lines: [{ text: "หีบของคุณตา จดหมายกับแผนที่ถูกเก็บไว้อย่างดี" }] });
  }

  private bedDialogue() {
    this.say({
      lines: [{ text: this.flags.house_repaired ? "เตียงนุ่มสะอาด กลิ่นผ้าใหม่" : "ฟูกเก่าของคุณตา พอนอนได้แม้หลังคาจะรั่ว" }],
      choices: [
        { label: "นอนพักถึงเช้า (บันทึกอัตโนมัติ)", pick: () => (this.sleep(false), null) },
        { label: "ยังไม่นอน", pick: () => null },
      ],
    });
  }

  // ---------------------------------------------------------------- night
  sleep(passedOut: boolean) {
    const w = this.w;
    const inv = this.state.inventory;
    const st = this.state.stats;
    const msgs: string[] = [];

    // Shipping payout
    if (w.shippingBin > 0) {
      const pay = w.shippingBin * RADISH_PRICE;
      inv.money = Math.min(LIMITS.moneyMax, inv.money + pay);
      st.shipped = Math.min(LIMITS.statMax, st.shipped + w.shippingBin);
      st.earned = Math.min(LIMITS.statMax, st.earned + pay);
      msgs.push(`ได้เงินจากการส่งขาย ${pay} เหรียญ`);
      w.shippingBin = 0;
    }

    // Crops grow overnight if watered
    let grew = 0;
    for (const t of w.tiles) {
      if (t.crop !== "none" && t.watered && t.growth < RADISH_GROW_NIGHTS) {
        t.growth++;
        grew++;
      }
    }

    // New day
    w.day = Math.min(LIMITS.dayMax, w.day + 1);
    w.weather = weatherFor(w.day);
    for (const t of w.tiles) t.watered = t.tilled && w.weather === "rain";
    w.time = DAY_START;
    w.stamina = passedOut ? Math.floor(STAMINA_MAX / 2) : STAMINA_MAX;
    w.daily = { caretaker: false, visitor: false, dog: false };
    w.location = "house";
    Object.assign(w.player, { x: BED.x + 1.5, z: BED.z + 0.5, facing: Math.PI / 2 });

    // A few branches and rocks wash in overnight (never onto tilled soil)
    let spawnedBranch = 0;
    let spawnedRock = 0;
    DEBRIS.forEach((d, i) => {
      if (w.debris[i] || !DEBRIS_INFO[d.kind].respawns) return;
      const ti = tileIndexAt(d.x, d.z);
      if (ti >= 0 && w.tiles[ti].tilled) return;
      if (hash(w.day * 31 + i) > 0.45) return;
      if (d.kind === "branch" && spawnedBranch < 3) (w.debris[i] = true), spawnedBranch++;
      if (d.kind === "rock" && spawnedRock < 2) (w.debris[i] = true), spawnedRock++;
    });

    const ready = w.tiles.filter((t) => t.crop !== "none" && t.growth >= RADISH_GROW_NIGHTS).length;
    if (ready) msgs.push(`หัวไชเท้าพร้อมเก็บ ${ready} หัว!`);
    else if (grew) msgs.push(`ผักโตขึ้น ${grew} ต้น`);
    if (w.weather === "rain") msgs.push("วันนี้ฝนตก ผักได้น้ำทั้งแปลง");

    this.sfx("sleep");
    this.emit({ type: "teleport" });
    this.emit({ type: "fade", text: [this.dateText(), ...msgs].join("\n") });
    this.emit({ type: "autosave" });
  }

  /** Intro letter shown once at the start of a new game. */
  intro() {
    if (this.flags.intro_done) return;
    this.flags.intro_done = true;
    this.say({
      lines: [
        { who: N.letter, text: "\"ถึงหลานรัก ตาฝากบ้านไร่หลังเก่าที่หมู่บ้านดอยฝนไว้ให้หลานนะ\"" },
        { who: N.letter, text: "\"บ้านคงทรุดโทรมไปมาก แต่ตาเชื่อว่าบ้านที่มีคนอยู่ จะกลับมามีชีวิตอีกครั้ง\"" },
        { who: N.letter, text: "\"ป้าบุญข้างบ้านจะช่วยหลานเอง ฝากดูแลไร่ ดูแลบ้าน และดูแลหมู่บ้านของเราด้วย\"" },
        { text: "หลังเดินทางมาทั้งวัน ในที่สุดก็มาถึงทางเข้าไร่ของคุณตา..." },
      ],
    });
  }
}
