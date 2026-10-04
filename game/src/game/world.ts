import * as THREE from "three";
import { ps1Material } from "../render/ps1";
import { tex, tex2, tex3 } from "../render/textures";
import {
  BED,
  CHEST,
  DEBRIS,
  FARM_BOUNDS,
  FIELD,
  HOUSE,
  INTERIOR,
  LAMP,
  RADISH_GROW_NIGHTS,
  ROAD,
  SHIPPING_BIN,
  SIGNPOST,
  TILE_COUNT,
  TREES,
  WELL,
  WORKBENCH,
  tileCenter,
} from "../sim/data";
import type { Game } from "../sim/game";

// Builds the PS1-style scene and keeps it in sync with the game state.
// Geometry, materials and textures are created once and shared.

interface Person {
  root: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  marker?: THREE.Object3D;
}

const SKY_DAY = new THREE.Color("#f4d3a0");
const SKY_RAIN = new THREE.Color("#8d98a0");
const SKY_NIGHT = new THREE.Color("#1b2140");
const INDOOR_BG = new THREE.Color("#140d08");

export class WorldView {
  scene = new THREE.Scene();
  player: Person;
  caretaker: Person;
  visitor: Person;
  dog: THREE.Group;
  private houseOld: THREE.Group;
  private houseNew: THREE.Group;
  private windowGlow: THREE.Mesh[] = [];
  private interiorOld = new THREE.Group();
  private interiorNew = new THREE.Group();
  private chestLid!: THREE.Mesh;
  private tiles: THREE.Mesh[] = [];
  private crops: THREE.Object3D[][] = [];
  private debris: THREE.Object3D[] = [];
  private highlight: THREE.LineSegments;
  private rain: THREE.Points;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private lampLight: THREE.PointLight;
  private lampBulb: THREE.Mesh;
  private indoorLight: THREE.PointLight;
  private soilDry: THREE.Material;
  private soilWet: THREE.Material;
  private walkPhase = 0;
  private hills = new THREE.Group();

  constructor(private snapRes: THREE.Vector2) {
    const s = this.scene;
    s.background = SKY_DAY.clone();
    s.fog = new THREE.Fog(SKY_DAY.clone(), 20, 46);

    this.hemi = new THREE.HemisphereLight("#ffe9c4", "#5a4a3a", 1.4);
    this.sun = new THREE.DirectionalLight("#ffd9a0", 1.6);
    this.sun.position.set(-8, 14, 6);
    s.add(this.hemi, this.sun);

    this.soilDry = this.m("soil", tex.soil());
    this.soilWet = this.m("wetSoil", tex2.wetSoil());

    this.buildGround();
    this.houseOld = this.buildHouse(true);
    this.houseNew = this.buildHouse(false);
    s.add(this.houseOld, this.houseNew);
    this.buildProps();
    this.buildField();
    this.buildDebris();
    this.buildInterior();

    const lamp = this.buildLamp();
    this.lampLight = lamp.light;
    this.lampBulb = lamp.bulb;
    this.indoorLight = new THREE.PointLight("#ffb766", 0, 14, 1.2);
    this.indoorLight.position.set(INTERIOR.x, 3, INTERIOR.z);
    s.add(this.indoorLight);

    this.player = this.person({ shirt: "cloth", pants: "#3b3328", hair: "#2a1d14", skin: "#e0b48a" });
    this.caretaker = this.person({ shirt: "#6a4c8c", pants: "#4a3560", hair: "#cfcfcf", skin: "#c99a70", skirt: true, marker: true });
    this.visitor = this.person({ shirt: "#b8433a", pants: "#2c3e5c", hair: "#1a1410", skin: "#e2b892", marker: true });
    this.dog = this.buildDog();
    s.add(this.player.root, this.caretaker.root, this.visitor.root, this.dog);

    const hl = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.98, 0.98));
    this.highlight = new THREE.LineSegments(hl, new THREE.LineBasicMaterial({ color: "#fff2b0" }));
    this.highlight.rotation.x = -Math.PI / 2;
    s.add(this.highlight);

    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: "#c8d6e6", size: 2, sizeAttenuation: false }));
    s.add(this.rain);
  }

  // --------------------------------------------------------------- helpers
  private m(key: string, map: THREE.Texture, repeat = 1, extra: THREE.MeshLambertMaterialParameters = {}) {
    if (repeat !== 1) {
      map = map.clone();
      map.repeat.set(repeat, repeat);
      map.needsUpdate = true;
    }
    return ps1Material(`${key}x${repeat}`, this.snapRes, { map, ...extra });
  }
  private c(color: string) {
    return ps1Material(`c${color}`, this.snapRes, { color });
  }
  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }
  private glow(color: string) {
    return new THREE.MeshBasicMaterial({ color, fog: false });
  }

  // --------------------------------------------------------------- builders
  private buildGround() {
    const s = this.scene;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90, 10, 10), this.m("grass", tex.grass(), 40));
    ground.rotation.x = -Math.PI / 2;
    s.add(ground);

    const path = (x0: number, x1: number, z0: number, z1: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.m("path", tex2.path(), 1));
      p.rotation.x = -Math.PI / 2;
      p.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
      s.add(p);
    };
    path(ROAD.x0 - 2, ROAD.x1 + 6, ROAD.z0, ROAD.z1); // road to the village
    path(-1, 1, -3.5, 2); // walkway to the door
    path(1, ROAD.x0 - 2, 1.2, 2.2);

    // Fence around the farm with a gap for the road
    const post = new THREE.CylinderGeometry(0.08, 0.1, 1, 5);
    const rail = this.m("oldPlank", tex.oldPlank());
    const pts: [number, number][] = [];
    const { x0, x1, z0, z1 } = FARM_BOUNDS;
    for (let x = x0; x <= x1; x += 1.5) pts.push([x, z0], [x, z1]);
    for (let z = z0; z <= z1; z += 1.5) {
      pts.push([x0, z]);
      if (z < ROAD.z0 - 0.2 || z > ROAD.z1 + 0.2) pts.push([x1, z]);
    }
    const posts = new THREE.InstancedMesh(post, rail, pts.length);
    const mtx = new THREE.Matrix4();
    pts.forEach(([x, z], i) => posts.setMatrixAt(i, mtx.makeTranslation(x, 0.5, z)));
    s.add(posts);
    const railMesh = (x: number, z: number, len: number, alongX: boolean) => {
      const r = this.box(alongX ? len : 0.08, 0.1, alongX ? 0.08 : len, rail, x, 0.7, z);
      s.add(r);
    };
    railMesh((x0 + x1) / 2, z0, x1 - x0, true);
    railMesh((x0 + x1) / 2, z1, x1 - x0, true);
    railMesh(x0, (z0 + z1) / 2, z1 - z0, false);
    railMesh(x1, (z0 + ROAD.z0) / 2, ROAD.z0 - z0, false);
    railMesh(x1, (ROAD.z1 + z1) / 2, z1 - ROAD.z1, false);

    // Distant hills for depth (fade into fog)
    const hillMat = this.m("hill", tex2.hill(), 4);
    s.add(this.hills);
    const hills: [number, number, number, number][] = [
      [-30, -34, 14, 12], [0, -40, 18, 15], [28, -32, 13, 10], [40, 0, 12, 11], [34, 26, 14, 9], [-36, 18, 12, 10], [-42, -8, 15, 13], [10, 36, 16, 9],
    ];
    for (const [x, z, r, h] of hills) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), hillMat);
      hill.position.set(x, h / 2 - 0.5, z);
      this.hills.add(hill);
    }

    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2, 5);
    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    for (const t of TREES) {
      const trunk = new THREE.Mesh(trunkGeo, this.m("bark", tex.bark()));
      trunk.position.set(t.x, 1, t.z);
      const crown = new THREE.Mesh(crownGeo, this.m("leaves", tex.leaves()));
      crown.position.set(t.x, 2.2 + t.r * 0.6, t.z);
      crown.scale.setScalar(t.r);
      s.add(trunk, crown);
    }

    // Flowers along the front of the house
    const petal = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const cols = ["#e8c34a", "#e86a5a", "#f0f0f0", "#d07ad0"];
    for (let i = 0; i < 12; i++) {
      const f = new THREE.Mesh(petal, this.c(cols[i % cols.length]));
      f.position.set(-2.8 + (i % 6) * 0.35 + (i > 5 ? 3.9 : 0), 0.12, -3.2 + (i % 2) * 0.2);
      s.add(f);
    }
  }

  private buildHouse(broken: boolean) {
    const g = new THREE.Group();
    const wall = broken ? this.m("oldPlank", tex.oldPlank()) : this.m("newPlank", tex.newPlank());
    const roof = broken ? ps1Material("roofOld", this.snapRes, { map: tex.roofTile(), color: "#7a7a7a" }) : this.m("roof", tex.roofTile());
    g.add(this.box(HOUSE.w, 3, HOUSE.d, wall, 0, 1.5, 0));
    g.add(this.box(HOUSE.w + 0.3, 0.3, HOUSE.d + 0.3, this.m("stone", tex2.stone()), 0, 0.15, 0)); // foundation
    const r = new THREE.Mesh(new THREE.ConeGeometry(4.8, 2.2, 4), roof);
    r.position.y = 4.1;
    r.rotation.y = Math.PI / 4;
    r.scale.set(1, 1, 0.85);
    if (broken) r.rotation.z = 0.08;
    g.add(r);
    g.add(this.box(0.6, 1.6, 0.6, broken ? this.c("#5c5650") : this.m("stone", tex2.stone()), 1.6, 4.4, -0.6)); // chimney
    g.add(this.box(1.2, 2, 0.1, this.c(broken ? "#2a2018" : "#6b3b1c"), 0, 1, HOUSE.d / 2 + 0.01));
    for (const wx of [-1.9, 1.9]) {
      const win = this.box(1, 0.8, 0.08, broken ? this.c("#1a1612") : this.glow("#ffd27a"), wx, 1.8, HOUSE.d / 2 + 0.02);
      g.add(win);
      if (!broken) this.windowGlow.push(win);
      g.add(this.box(1.2, 0.12, 0.14, wall, wx, 1.35, HOUSE.d / 2 + 0.05));
    }
    if (broken) {
      // hanging loose boards and a hole in the roof
      const plank = this.box(0.3, 1.4, 0.06, this.m("oldPlank", tex.oldPlank()), -1.9, 1.6, HOUSE.d / 2 + 0.08);
      plank.rotation.z = 0.5;
      g.add(plank);
      const hole = this.box(1.2, 0.05, 0.9, this.c("#140f0b"), -1, 4.1, 0.9);
      hole.rotation.x = -0.5;
      g.add(hole);
    } else {
      // porch roof
      g.add(this.box(2.4, 0.12, 1.1, roof, 0, 2.55, HOUSE.d / 2 + 0.5));
    }
    g.position.set(HOUSE.x, 0, HOUSE.z);
    return g;
  }

  private buildProps() {
    const s = this.scene;
    const plank = this.m("newPlank", tex.newPlank());
    const old = this.m("oldPlank", tex.oldPlank());
    // Shipping bin
    const bin = new THREE.Group();
    bin.add(this.box(1.2, 0.8, 0.9, plank, 0, 0.4, 0));
    bin.add(this.box(1.3, 0.12, 1.0, this.c("#7a4a22"), 0, 0.86, 0));
    bin.position.set(SHIPPING_BIN.x, 0, SHIPPING_BIN.z);
    s.add(bin);
    // Workbench
    const wb = new THREE.Group();
    wb.add(this.box(1.6, 0.12, 0.9, old, 0, 0.9, 0));
    for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) wb.add(this.box(0.12, 0.9, 0.12, old, x, 0.45, z));
    wb.add(this.box(0.7, 0.05, 0.25, this.c("#9aa0a6"), 0.2, 0.99, 0)); // saw
    wb.add(this.box(0.6, 0.1, 0.4, this.c("#d9c79a"), -0.4, 0.99, 0.1)); // plans
    wb.position.set(WORKBENCH.x, 0, WORKBENCH.z);
    s.add(wb);
    // Well
    const well = new THREE.Group();
    well.add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.8, 8, 1, true), this.m("stone", tex2.stone())));
    well.children[0].position.y = 0.4;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.75, 8), this.m("water", tex2.water()));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.55;
    well.add(water);
    for (const x of [-0.75, 0.75]) well.add(this.box(0.12, 2, 0.12, old, x, 1, 0));
    const wroof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.7, 4), this.m("roof", tex.roofTile()));
    wroof.position.y = 2.3;
    wroof.rotation.y = Math.PI / 4;
    well.add(wroof);
    well.position.set(WELL.x, 0, WELL.z);
    s.add(well);
    // Signpost
    const sign = new THREE.Group();
    sign.add(this.box(0.15, 1.6, 0.15, old, 0, 0.8, 0));
    sign.add(this.box(1.2, 0.35, 0.08, plank, 0.2, 1.35, 0));
    sign.position.set(SIGNPOST.x, 0, SIGNPOST.z);
    s.add(sign);
  }

  private buildLamp() {
    const g = new THREE.Group();
    g.add(this.box(0.12, 2.2, 0.12, this.c("#3a2c22"), 0, 1.1, 0));
    const bulb = this.box(0.3, 0.3, 0.3, this.glow("#5a4a30"), 0, 2.3, 0);
    g.add(bulb);
    const light = new THREE.PointLight("#ffbb66", 0, 9, 1.5);
    light.position.set(0, 2.3, 0);
    g.add(light);
    g.position.set(LAMP.x, 0, LAMP.z);
    this.scene.add(g);
    return { light, bulb };
  }

  private buildField() {
    const tileGeo = new THREE.PlaneGeometry(0.96, 0.96);
    const sproutGeo = new THREE.ConeGeometry(0.08, 0.25, 4);
    const leafGeo = new THREE.BoxGeometry(0.12, 0.35, 0.04);
    const rootGeo = new THREE.CylinderGeometry(0.13, 0.06, 0.32, 5);
    const leaf = this.c("#4f9a3a");
    const root = this.c("#f1efe4");
    for (let i = 0; i < TILE_COUNT; i++) {
      const { x, z } = tileCenter(i);
      const t = new THREE.Mesh(tileGeo, this.soilDry);
      t.rotation.x = -Math.PI / 2;
      t.position.set(x, 0.02, z);
      this.scene.add(t);
      this.tiles.push(t);

      const sprout = new THREE.Mesh(sproutGeo, leaf);
      sprout.position.set(x, 0.14, z);
      const mid = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const l = new THREE.Mesh(leafGeo, leaf);
        l.position.set(Math.cos(k * 2.1) * 0.08, 0.2, Math.sin(k * 2.1) * 0.08);
        l.rotation.set(Math.sin(k * 2.1) * 0.4, k * 2.1, Math.cos(k * 2.1) * 0.4);
        mid.add(l);
      }
      mid.position.set(x, 0, z);
      const ripe = new THREE.Group();
      const r = new THREE.Mesh(rootGeo, root);
      r.position.y = 0.16;
      ripe.add(r);
      for (let k = 0; k < 4; k++) {
        const l = new THREE.Mesh(leafGeo, leaf);
        l.scale.set(1.3, 1.4, 1);
        l.position.set(Math.cos(k * 1.6) * 0.1, 0.5, Math.sin(k * 1.6) * 0.1);
        l.rotation.set(Math.sin(k * 1.6) * 0.5, k * 1.6, Math.cos(k * 1.6) * 0.5);
        ripe.add(l);
      }
      ripe.position.set(x, 0, z);
      this.scene.add(sprout, mid, ripe);
      this.crops.push([sprout, mid, ripe]);
    }
    // rough, weedy ground marks the whole field before it is tilled
    const base = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.cols, FIELD.rows), this.m("rough", tex3.rough(), 4));
    base.rotation.x = -Math.PI / 2;
    base.position.set(FIELD.x0 + FIELD.cols / 2, 0.012, FIELD.z0 + FIELD.rows / 2);
    this.scene.add(base);
    // field border logs
    const log = this.m("bark", tex.bark());
    const { x0, z0, cols, rows } = FIELD;
    this.scene.add(this.box(cols + 0.2, 0.15, 0.15, log, x0 + cols / 2, 0.08, z0 - 0.1));
    this.scene.add(this.box(cols + 0.2, 0.15, 0.15, log, x0 + cols / 2, 0.08, z0 + rows + 0.1));
  }

  private buildDebris() {
    const branchGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.8, 4);
    const stumpGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.5, 6);
    const rockGeo = new THREE.DodecahedronGeometry(0.26, 0);
    const boulderGeo = new THREE.DodecahedronGeometry(0.55, 0);
    const bark = this.m("bark", tex.bark());
    const stone = this.m("stone", tex2.stone());
    DEBRIS.forEach((d, i) => {
      let o: THREE.Object3D;
      if (d.kind === "branch") {
        const g = new THREE.Group();
        const a = new THREE.Mesh(branchGeo, bark);
        a.rotation.z = Math.PI / 2;
        a.rotation.y = i * 1.3;
        const b = new THREE.Mesh(branchGeo, bark);
        b.scale.setScalar(0.6);
        b.rotation.z = Math.PI / 2;
        b.rotation.y = i * 1.3 + 0.8;
        g.add(a, b);
        g.position.y = 0.06;
        o = g;
      } else if (d.kind === "stump") {
        o = new THREE.Mesh(stumpGeo, bark);
        o.position.y = 0.25;
      } else {
        o = new THREE.Mesh(d.kind === "rock" ? rockGeo : boulderGeo, stone);
        o.position.y = d.kind === "rock" ? 0.15 : 0.4;
        o.rotation.y = i;
      }
      o.position.x = d.x;
      o.position.z = d.z;
      this.scene.add(o);
      this.debris.push(o);
    });
  }

  private buildInterior() {
    const { x, z, w, d } = INTERIOR;
    const voidFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), this.c("#0d0805"));
    voidFloor.rotation.x = -Math.PI / 2;
    voidFloor.position.set(x, -0.02, z);
    this.scene.add(voidFloor);
    const build = (g: THREE.Group, repaired: boolean) => {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), repaired ? this.m("floor", tex2.floor(), 2) : this.m("dustyFloor", tex2.dustyFloor(), 2));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(x, 0.01, z);
      g.add(floor);
      const wall = repaired ? this.m("newPlank", tex.newPlank()) : this.m("oldPlank", tex.oldPlank());
      g.add(this.box(w, 2.6, 0.2, wall, x, 1.3, z - d / 2));
      g.add(this.box(0.2, 2.6, d, wall, x - w / 2, 1.3, z));
      g.add(this.box(0.2, 2.6, d, wall, x + w / 2, 1.3, z));
      g.add(this.box(w / 2 - 0.7, 0.8, 0.2, wall, x - w / 4 - 0.35, 0.4, z + d / 2)); // low front walls keep the room visible
      g.add(this.box(w / 2 - 0.7, 0.8, 0.2, wall, x + w / 4 + 0.35, 0.4, z + d / 2));
      // bed
      g.add(this.box(1.6, 0.35, 2.4, this.m("bark", tex.bark()), BED.x, 0.18, BED.z));
      g.add(this.box(1.4, 0.15, 2.2, this.c(repaired ? "#e8e2d0" : "#8a8070"), BED.x, 0.42, BED.z));
      g.add(this.box(1.3, 0.12, 1.2, this.c(repaired ? "#4a78a8" : "#5a5248"), BED.x, 0.52, BED.z + 0.45));
      g.add(this.box(0.8, 0.15, 0.4, this.c("#f0eadc"), BED.x, 0.55, BED.z - 0.85));
      // table and stools
      g.add(this.box(1.4, 0.1, 1.0, this.m("newPlank", tex.newPlank()), x, 0.75, z - 0.3));
      g.add(this.box(0.12, 0.7, 0.12, this.c("#5a3a20"), x - 0.55, 0.35, z - 0.6));
      g.add(this.box(0.12, 0.7, 0.12, this.c("#5a3a20"), x + 0.55, 0.35, z - 0.6));
      g.add(this.box(0.12, 0.7, 0.12, this.c("#5a3a20"), x - 0.55, 0.35, z));
      g.add(this.box(0.12, 0.7, 0.12, this.c("#5a3a20"), x + 0.55, 0.35, z));
      if (repaired) {
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), this.c("#a8483a"));
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(x, 0.02, z + 1.4);
        g.add(rug);
        g.add(this.box(0.4, 0.4, 0.4, this.c("#8a5a3a"), x + 3.4, 0.2, z + 2.2));
        const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), this.m("leaves", tex.leaves()));
        plant.position.set(x + 3.4, 0.7, z + 2.2);
        g.add(plant);
        g.add(this.box(0.25, 0.3, 0.25, this.glow("#ffd27a"), x, 0.95, z - 0.3)); // table lamp
        g.add(this.box(1.2, 0.8, 0.05, this.c("#d8cfb4"), x - 1.4, 1.6, z - d / 2 + 0.12)); // calendar/photo
      } else {
        for (let i = 0; i < 4; i++) {
          const b = this.box(0.25, 0.05, 1.2, this.m("oldPlank", tex.oldPlank()), x - 1 + i * 0.9, 0.04, z + 1.2 - (i % 2) * 0.6);
          b.rotation.y = i * 0.7;
          g.add(b);
        }
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.6, 6), this.m("water", tex2.water()));
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(CHEST.x - 0.6, 0.02, CHEST.z + 1.2);
        g.add(puddle);
      }
    };
    build(this.interiorOld, false);
    build(this.interiorNew, true);
    // The chest is shared by both versions (it is the same chest)
    const chest = this.box(1.2, 0.6, 0.8, this.m("bark", tex.bark()), CHEST.x, 0.3, CHEST.z);
    this.chestLid = this.box(1.25, 0.15, 0.85, this.m("newPlank", tex.newPlank()), CHEST.x, 0.68, CHEST.z);
    this.scene.add(chest, this.chestLid, this.interiorOld, this.interiorNew);
  }

  private person(o: { shirt: string; pants: string; hair: string; skin: string; skirt?: boolean; marker?: boolean }): Person {
    const root = new THREE.Group();
    const shirt = o.shirt === "cloth" ? this.m("cloth", tex.cloth()) : this.c(o.shirt);
    const skin = this.c(o.skin);
    const pants = this.c(o.pants);
    root.add(this.box(0.6, 0.75, 0.35, shirt, 0, 1.12, 0));
    root.add(this.box(0.46, 0.46, 0.44, skin, 0, 1.75, 0));
    root.add(this.box(0.5, 0.2, 0.48, this.c(o.hair), 0, 2.02, -0.02));
    root.add(this.box(0.5, 0.36, 0.1, this.c(o.hair), 0, 1.84, -0.2));
    root.add(this.box(0.08, 0.08, 0.04, this.c("#1a1410"), -0.1, 1.78, 0.23));
    root.add(this.box(0.08, 0.08, 0.04, this.c("#1a1410"), 0.1, 1.78, 0.23));
    const limb = (x: number, y: number, h: number, mat: THREE.Material) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const b = this.box(0.2, h, 0.22, mat, 0, -h / 2, 0);
      pivot.add(b);
      root.add(pivot);
      return pivot;
    };
    const legL = limb(-0.15, 0.75, 0.75, pants);
    const legR = limb(0.15, 0.75, 0.75, pants);
    if (o.skirt) root.add(this.box(0.66, 0.5, 0.42, pants, 0, 0.62, 0));
    const armL = limb(-0.4, 1.45, 0.65, shirt);
    const armR = limb(0.4, 1.45, 0.65, shirt);
    let marker: THREE.Object3D | undefined;
    if (o.marker) {
      marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), this.glow("#ffd23a"));
      marker.position.y = 2.6;
      root.add(marker);
    }
    return { root, legL, legR, armL, armR, marker };
  }

  private buildDog() {
    const g = new THREE.Group();
    const fur = this.c("#b07a3e");
    g.add(this.box(0.35, 0.3, 0.7, fur, 0, 0.4, 0));
    g.add(this.box(0.3, 0.3, 0.3, fur, 0, 0.62, 0.42));
    g.add(this.box(0.18, 0.12, 0.16, this.c("#e8d8b8"), 0, 0.55, 0.62));
    g.add(this.box(0.08, 0.14, 0.06, this.c("#5a3a20"), -0.12, 0.82, 0.38));
    g.add(this.box(0.08, 0.14, 0.06, this.c("#5a3a20"), 0.12, 0.82, 0.38));
    for (const [x, z] of [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]]) g.add(this.box(0.1, 0.28, 0.1, fur, x, 0.14, z));
    const tail = this.box(0.06, 0.06, 0.3, fur, 0, 0.55, -0.45);
    tail.rotation.x = -0.6;
    g.add(tail);
    return g;
  }

  // ------------------------------------------------------------------ sync
  private animate(p: Person, moving: boolean, dt: number, phaseOffset = 0) {
    const sw = moving ? Math.sin(this.walkPhase + phaseOffset) * 0.6 : 0;
    p.legL.rotation.x = sw;
    p.legR.rotation.x = -sw;
    p.armL.rotation.x = -sw * 0.8;
    p.armR.rotation.x = sw * 0.8;
    if (p.marker) {
      p.marker.rotation.y += dt * 2;
      p.marker.position.y = 2.6 + Math.sin(this.walkPhase * 0.4) * 0.08;
    }
  }

  /** Swing the right arm for a tool use. */
  swing = 0;

  sync(game: Game, dt: number, moving: boolean) {
    const st = game.state;
    const w = st.world;
    const f = st.story.flags;
    this.walkPhase += dt * (moving ? 10 : 3);

    const p = w.player;
    this.player.root.position.set(p.x, 0, p.z);
    this.player.root.rotation.y = p.facing;
    this.animate(this.player, moving, dt);
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4);
      this.player.armR.rotation.x = -Math.sin(this.swing * Math.PI) * 2.2;
    }

    const place = (person: Person, pos: { x: number; z: number } | null, markerOn: boolean) => {
      person.root.visible = !!pos;
      if (!pos) return;
      person.root.position.set(pos.x, 0, pos.z);
      person.root.rotation.y = Math.atan2(p.x - pos.x, p.z - pos.z);
      this.animate(person, false, dt, 1);
      if (person.marker) person.marker.visible = markerOn;
    };
    place(this.caretaker, game.caretakerPos(), !f.met_caretaker);
    place(this.visitor, game.visitorPos(), !f.met_visitor || (f.found_clue && !st.story.choice));

    const dp = game.dogPos();
    this.dog.visible = !!dp;
    if (dp) {
      const prev = this.dog.position.clone();
      this.dog.position.set(dp.x, 0, dp.z);
      const dx = dp.x - prev.x;
      const dz = dp.z - prev.z;
      if (dx * dx + dz * dz > 1e-6) this.dog.rotation.y = Math.atan2(dx, dz);
    }

    this.houseOld.visible = !f.house_repaired;
    this.houseNew.visible = f.house_repaired;
    this.interiorOld.visible = !f.house_repaired;
    this.interiorNew.visible = f.house_repaired;
    this.chestLid.rotation.x = f.found_clue ? -1.1 : 0;
    this.chestLid.position.y = f.found_clue ? 0.85 : 0.68;
    this.chestLid.position.z = CHEST.z - (f.found_clue ? 0.3 : 0);

    w.tiles.forEach((t, i) => {
      this.tiles[i].visible = t.tilled;
      this.tiles[i].material = t.watered ? this.soilWet : this.soilDry;
      const [sprout, mid, ripe] = this.crops[i];
      const ripeNow = t.crop !== "none" && t.growth >= RADISH_GROW_NIGHTS;
      sprout.visible = t.crop !== "none" && t.growth === 0;
      mid.visible = t.crop !== "none" && t.growth > 0 && !ripeNow;
      mid.scale.setScalar(0.7 + t.growth * 0.3);
      ripe.visible = ripeNow;
    });
    this.debris.forEach((o, i) => (o.visible = w.debris[i]));

    // tool target highlight
    const ti = game.targetTile();
    const showHl = ti >= 0 && w.tool !== "axe" && w.tool !== "hammer";
    this.highlight.visible = showHl;
    if (showHl) {
      const c = tileCenter(ti);
      this.highlight.position.set(c.x, 0.05, c.z);
    }

    // lighting
    const indoors = w.location === "house";
    const dark = game.darkness();
    const rain = w.weather === "rain";
    const bg = this.scene.background as THREE.Color;
    const fog = this.scene.fog as THREE.Fog;
    if (indoors) {
      bg.copy(INDOOR_BG);
      fog.color.copy(INDOOR_BG);
      fog.near = 12;
      fog.far = 24;
      this.hemi.intensity = f.house_repaired ? 0.9 - dark * 0.4 : 0.45;
      this.sun.intensity = f.house_repaired ? 0.6 * (1 - dark) : 0.25;
      this.indoorLight.intensity = f.house_repaired ? 2 + dark * 6 : 0.4;
    } else {
      const day = rain ? SKY_RAIN : SKY_DAY;
      bg.copy(day).lerp(SKY_NIGHT, dark);
      fog.color.copy(bg);
      fog.near = rain ? 12 : 20;
      fog.far = rain ? 34 : 46;
      this.hemi.intensity = (rain ? 1.0 : 1.4) * (1 - dark * 0.65);
      this.sun.intensity = (rain ? 0.5 : 1.6) * (1 - dark * 0.9);
      this.sun.color.set(dark > 0.2 ? "#ff9a5a" : "#ffd9a0");
      this.indoorLight.intensity = 0;
    }
    this.hills.visible = !indoors;
    const lampOn = dark > 0.3 && !indoors;
    this.lampLight.intensity = lampOn ? 4 : 0;
    (this.lampBulb.material as THREE.MeshBasicMaterial).color.set(lampOn ? "#ffd27a" : "#5a4a30");
    for (const g of this.windowGlow) (g.material as THREE.MeshBasicMaterial).color.set(dark > 0.2 ? "#ffd27a" : "#8a7a5a");

    this.rain.visible = rain && !indoors;
    if (this.rain.visible) {
      const arr = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++) {
        let y = arr.getY(i) - dt * 14;
        if (y < 0) y += 12;
        arr.setY(i, y);
      }
      arr.needsUpdate = true;
      this.rain.position.set(p.x, 0, p.z);
    }
  }
}
