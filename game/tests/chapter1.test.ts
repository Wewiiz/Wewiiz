import { describe, expect, it } from "vitest";
import { Game, weatherFor, type Dialogue } from "../src/sim/game";
import { newGame, validateSave } from "../src/save/schema";
import {
  BED,
  CHEST,
  DEBRIS,
  DOOR,
  RADISH_GROW_NIGHTS,
  REPAIR_COST,
  SHIPPING_BIN,
  WORKBENCH,
  VISITOR_SPOT,
  tileCenter,
  tileIndexAt,
  type ToolId,
} from "../src/sim/data";

// Plays chapter 1 through the rules layer, the same calls the keyboard makes.

/** Stand so the spot is directly in front of the player (facing +z). */
function faceSpot(g: Game, x: number, z: number) {
  Object.assign(g.state.world.player, { x, z: z - 0.9, facing: 0 });
}

/** Returns the dialogue the last action opened, walking through chosen options. */
function lastDialogue(g: Game): Dialogue | null {
  const d = g.takeEvents().filter((e) => e.type === "dialogue");
  return d.length ? (d[d.length - 1] as { dialogue: Dialogue }).dialogue : null;
}
function choose(g: Game, ...labels: string[]): Dialogue | null {
  let d = lastDialogue(g);
  for (const label of labels) {
    expect(d, `expected a dialogue to pick "${label}"`).not.toBeNull();
    const c = d!.choices?.find((c) => c.label.includes(label));
    expect(c, `choice "${label}" in ${JSON.stringify(d!.choices?.map((x) => x.label))}`).toBeDefined();
    d = c!.pick();
  }
  return d;
}

function use(g: Game, tool: ToolId, x: number, z: number) {
  g.state.world.location = "farm";
  g.selectTool(tool);
  faceSpot(g, x, z);
  g.useTool();
}

function talkCaretaker(g: Game) {
  const p = g.caretakerPos()!;
  faceSpot(g, p.x, p.z);
  g.interact();
}

function sleepAtBed(g: Game) {
  g.state.world.location = "house";
  Object.assign(g.state.world.player, { x: BED.x + 1.5, z: BED.z, facing: -Math.PI / 2 });
  g.interact();
  choose(g, "นอนพัก");
}

function freeTiles(g: Game, n: number): number[] {
  const out: number[] = [];
  g.state.world.tiles.forEach((_, i) => {
    const blocked = DEBRIS.some((d, di) => g.state.world.debris[di] && tileIndexAt(d.x, d.z) === i);
    if (!blocked && out.length < n) out.push(i);
  });
  return out;
}

function farmDay(g: Game, tiles: number[]) {
  for (const i of tiles) {
    const c = tileCenter(i);
    use(g, "can", c.x, c.z);
  }
}

describe("chapter 1 playthrough", () => {
  for (const ending of ["stay_and_rebuild", "follow_the_clue"] as const) {
    it(`can be finished start to end (${ending})`, () => {
      const g = new Game(newGame());
      g.intro();
      expect(g.state.story.flags.intro_done).toBe(true);

      // Tools are locked until the caretaker hands them over
      use(g, "hoe", tileCenter(0).x, tileCenter(0).z);
      expect(g.state.world.tiles[0].tilled).toBe(false);

      talkCaretaker(g);
      choose(g, "ขอบคุณ");
      expect(g.state.story.flags.met_caretaker).toBe(true);
      g.takeEvents();

      // Day 1: till, plant, water six tiles
      const plot = freeTiles(g, 6);
      for (const i of plot) {
        const c = tileCenter(i);
        use(g, "hoe", c.x, c.z);
        use(g, "seeds", c.x, c.z);
      }
      expect(g.state.story.flags.first_planted).toBe(true);
      expect(g.state.inventory.seed_radish).toBe(0);
      farmDay(g, plot);
      expect(plot.every((i) => g.state.world.tiles[i].watered)).toBe(true);

      // Gather all debris over the first days, sleeping when tired
      const gatherAll = () => {
        DEBRIS.forEach((d, i) => {
          if (!g.state.world.debris[i]) return;
          const tool = d.kind === "branch" || d.kind === "stump" ? "axe" : "hammer";
          use(g, tool, d.x, d.z);
        });
      };
      gatherAll();
      sleepAtBed(g); // night 1
      expect(g.state.world.day).toBe(2);
      expect(g.state.world.stamina).toBe(100);
      farmDay(g, plot);
      gatherAll();
      sleepAtBed(g); // night 2
      expect(g.state.world.weather).toBe("rain"); // day 3 rain waters everything
      expect(plot.every((i) => g.state.world.tiles[i].watered)).toBe(true);
      gatherAll();
      sleepAtBed(g); // night 3
      expect(plot.every((i) => g.state.world.tiles[i].growth === RADISH_GROW_NIGHTS)).toBe(true);

      // Day 4: harvest and ship
      g.state.world.location = "farm";
      for (const i of plot) {
        const c = tileCenter(i);
        faceSpot(g, c.x, c.z);
        g.interact();
      }
      expect(g.state.inventory.radish).toBe(6);
      expect(g.state.story.flags.first_harvest).toBe(true);
      faceSpot(g, SHIPPING_BIN.x, SHIPPING_BIN.z - 0.4);
      g.interact();
      choose(g, "ใส่ทั้งหมด");
      expect(g.state.world.shippingBin).toBe(6);
      while (g.state.inventory.wood < REPAIR_COST.wood || g.state.inventory.stone < REPAIR_COST.stone) {
        gatherAll();
        sleepAtBed(g);
      }
      if (g.state.world.shippingBin) sleepAtBed(g);
      expect(g.state.inventory.money).toBeGreaterThanOrEqual(REPAIR_COST.money);
      expect(g.state.stats.shipped).toBe(6);

      // Repair the house
      g.state.world.location = "farm";
      faceSpot(g, WORKBENCH.x, WORKBENCH.z - 0.2);
      g.interact();
      choose(g, "ซ่อมเลย");
      expect(g.state.story.flags.house_repaired).toBe(true);
      expect(g.visitorPos()).toBeNull(); // visitor comes the next day
      sleepAtBed(g);

      // Visitor, clue, choice
      g.state.world.location = "farm";
      g.state.world.time = 9 * 60;
      expect(g.visitorPos()).toEqual(VISITOR_SPOT);
      faceSpot(g, VISITOR_SPOT.x, VISITOR_SPOT.z);
      g.interact();
      choose(g, "เดี๋ยวจะไปเปิดดู");
      expect(g.state.story.flags.met_visitor).toBe(true);

      g.state.world.location = "house";
      faceSpot(g, CHEST.x, CHEST.z - 0.3);
      g.interact();
      g.takeEvents();
      expect(g.state.story.flags.found_clue).toBe(true);

      g.state.world.location = "farm";
      faceSpot(g, VISITOR_SPOT.x, VISITOR_SPOT.z);
      g.interact();
      const label = ending === "stay_and_rebuild" ? "อยู่ฟื้นฟู" : "ออกเดินทาง";
      choose(g, label);
      expect(g.state.story.choice).toBe(ending);
      expect(g.state.story.flags.chapter_done).toBe(true);
      expect(g.takeEvents().some((e) => e.type === "ending")).toBe(true);
      expect(g.objective()).toContain("จบบทที่ 1");

      // The finished state is a valid save
      const json = JSON.parse(JSON.stringify(g.state));
      expect(validateSave(json).ok).toBe(true);
      expect(g.state.world.day).toBeGreaterThanOrEqual(5);
    });
  }
});

describe("rules", () => {
  it("unwatered crops do not grow", () => {
    const g = new Game(newGame());
    g.state.story.flags.met_caretaker = true;
    const [i] = freeTiles(g, 1);
    const c = tileCenter(i);
    use(g, "hoe", c.x, c.z);
    use(g, "seeds", c.x, c.z);
    sleepAtBed(g);
    expect(g.state.world.tiles[i].growth).toBe(0);
  });

  it("stamina runs out and blocks tool use", () => {
    const g = new Game(newGame());
    g.state.story.flags.met_caretaker = true;
    g.state.world.stamina = 1;
    const [i] = freeTiles(g, 1);
    use(g, "hoe", tileCenter(i).x, tileCenter(i).z);
    expect(g.state.world.tiles[i].tilled).toBe(false);
  });

  it("staying up past midnight passes out with half stamina", () => {
    const g = new Game(newGame());
    g.state.world.time = 24 * 60 - 1;
    g.tick(5);
    expect(g.state.world.day).toBe(2);
    expect(g.state.world.stamina).toBe(50);
  });

  it("watering can empties and refills at the well", () => {
    const g = new Game(newGame());
    g.state.story.flags.met_caretaker = true;
    g.state.world.water = 0;
    const [i] = freeTiles(g, 1);
    use(g, "hoe", tileCenter(i).x, tileCenter(i).z);
    use(g, "can", tileCenter(i).x, tileCenter(i).z);
    expect(g.state.world.tiles[i].watered).toBe(false);
    g.selectTool("can");
    Object.assign(g.state.world.player, { x: -5.5, z: 1.2, facing: Math.PI });
    g.useTool();
    expect(g.state.world.water).toBe(30);
  });

  it("cannot buy seeds without money", () => {
    const g = new Game(newGame());
    g.state.story.flags.met_caretaker = true;
    g.state.inventory.money = 10;
    talkCaretaker(g);
    choose(g, "ซื้อเมล็ด", "1 ซอง");
    expect(g.state.inventory.money).toBe(10);
  });

  it("walking into the door enters the house and back out", () => {
    const g = new Game(newGame());
    Object.assign(g.state.world.player, { x: DOOR.x, z: DOOR.z + 0.4, facing: Math.PI });
    for (let k = 0; k < 10 && g.state.world.location === "farm"; k++) g.move(0, -0.1);
    expect(g.state.world.location).toBe("house");
    for (let k = 0; k < 60 && g.state.world.location === "house"; k++) g.move(0, 0.1);
    expect(g.state.world.location).toBe("farm");
  });

  it("house walls block walking through", () => {
    const g = new Game(newGame());
    Object.assign(g.state.world.player, { x: 2, z: -2.5, facing: Math.PI });
    for (let k = 0; k < 40; k++) g.move(0, -0.1);
    expect(g.state.world.player.z).toBeGreaterThan(-3.5);
    expect(g.state.world.location).toBe("farm");
  });

  it("weather is fixed per day", () => {
    expect(weatherFor(3)).toBe("rain");
    expect(weatherFor(10)).toBe(weatherFor(10));
  });
});
