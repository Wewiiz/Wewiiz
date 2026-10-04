import * as THREE from "three";

// Small procedurally drawn pixel textures (no external image files yet).
// Every texture is created once and shared by all meshes that use it.

type Painter = (px: (x: number, y: number, c: string) => void, rnd: () => number) => void;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function make(size: number, seed: number, paint: Painter): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  paint(px, seeded(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const pick = (rnd: () => number, cols: string[]) => cols[Math.floor(rnd() * cols.length)];

const cache = new Map<string, THREE.Texture>();
const once = (key: string, f: () => THREE.Texture) => cache.get(key) ?? (cache.set(key, f()), cache.get(key)!);

export const tex = {
  grass: () =>
    once("grass", () =>
      make(16, 1, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#5b8a3a", "#4f7d33", "#6a9a44", "#557f36"]));
      }),
    ),
  soil: () =>
    once("soil", () =>
      make(16, 2, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) px(x, y, y % 4 === 0 ? "#4a3020" : pick(r, ["#6b4528", "#734b2c", "#5f3d23"]));
      }),
    ),
  oldPlank: () =>
    once("oldPlank", () =>
      make(16, 3, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++)
            px(x, y, y % 5 === 0 ? "#3a2c22" : pick(r, ["#7a6a58", "#6e5f4f", "#837261", "#5d5045"]));
      }),
    ),
  newPlank: () =>
    once("newPlank", () =>
      make(16, 4, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) px(x, y, y % 5 === 0 ? "#7a4a22" : pick(r, ["#c98a4b", "#d39552", "#bf8044"]));
      }),
    ),
  roofTile: () =>
    once("roofTile", () =>
      make(16, 5, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++)
            px(x, y, y % 4 === 3 || (x + (y >> 2) * 2) % 8 === 0 ? "#5a2418" : pick(r, ["#a2412b", "#963a26", "#ad4a31"]));
      }),
    ),
  leaves: () =>
    once("leaves", () =>
      make(16, 6, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#2f6b2f", "#3b7d34", "#28592a", "#47883b"]));
      }),
    ),
  bark: () =>
    once("bark", () =>
      make(8, 7, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, x % 3 === 0 ? "#3d2a1c" : pick(r, ["#5c3f2a", "#664730"]));
      }),
    ),
  cloth: () =>
    once("cloth", () =>
      make(8, 8, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, pick(r, ["#2f5f8f", "#346699", "#2b5784"]));
      }),
    ),
};

export const tex2 = {
  path: () =>
    once("path", () =>
      make(16, 9, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#b08a5a", "#a57f50", "#bb9563", "#9c774a"]));
      }),
    ),
  wetSoil: () =>
    once("wetSoil", () =>
      make(16, 10, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) px(x, y, y % 4 === 0 ? "#2a1a10" : pick(r, ["#43291a", "#3d2517", "#4a2e1d"]));
      }),
    ),
  stone: () =>
    once("stone", () =>
      make(16, 11, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#8b8a85", "#7a7974", "#9a9993", "#6d6c68"]));
      }),
    ),
  floor: () =>
    once("floor", () =>
      make(16, 12, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) px(x, y, x % 4 === 0 ? "#5a3a20" : pick(r, ["#9c6b3e", "#a87545", "#946539"]));
      }),
    ),
  dustyFloor: () =>
    once("dustyFloor", () =>
      make(16, 13, (px, r) => {
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 16; x++) px(x, y, x % 4 === 0 ? "#2e261e" : pick(r, ["#5b5045", "#625649", "#53493f", "#6c6052"]));
      }),
    ),
  water: () =>
    once("water", () =>
      make(8, 14, (px, r) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(x, y, pick(r, ["#3d6f8f", "#457a9c", "#36678a"]));
      }),
    ),
  hill: () =>
    once("hill", () =>
      make(16, 15, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#4c6e3c", "#557a43", "#456535", "#5d7f48"]));
      }),
    ),
};

export const tex3 = {
  rough: () =>
    once("rough", () =>
      make(16, 16, (px, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, ["#6b5a36", "#5f5030", "#5b7a35", "#74613b", "#4f6b2f"]));
      }),
    ),
};
