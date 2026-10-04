import * as THREE from "three";
import { ps1Material } from "../render/ps1";
import { tex } from "../render/textures";
import { LIMITS } from "../save/schema";

// Placeholder world for the prototype: the old house, the field plots, a tree
// and the player. Geometry is shared wherever possible.

export interface World {
  scene: THREE.Scene;
  player: THREE.Group;
  house: { old: THREE.Group; repaired: THREE.Group };
  plots: THREE.Mesh[];
}

export function buildWorld(snapRes: THREE.Vector2): World {
  const scene = new THREE.Scene();
  const sky = new THREE.Color("#f2c58c");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 18, 42);

  scene.add(new THREE.HemisphereLight("#ffe9c4", "#5a4a3a", 1.4));
  const sun = new THREE.DirectionalLight("#ffd9a0", 1.6);
  sun.position.set(-8, 14, 6);
  scene.add(sun);

  const mat = (key: string, map: THREE.Texture, repeat = 1) => {
    if (repeat !== 1) {
      map = map.clone();
      map.repeat.set(repeat, repeat);
      map.needsUpdate = true;
    }
    return ps1Material(`${key}x${repeat}`, snapRes, { map });
  };

  // Ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(LIMITS.worldHalfSize, LIMITS.worldHalfSize, 8, 8), mat("grass", tex.grass(), 24));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // House: two versions, toggled when the repair is done.
  const makeHouse = (wall: THREE.Material, roof: THREE.Material, broken: boolean) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 5), wall);
    body.position.y = 1.5;
    g.add(body);
    const roofGeo = new THREE.ConeGeometry(4.8, 2.2, 4);
    const r = new THREE.Mesh(roofGeo, roof);
    r.position.y = 4.1;
    r.rotation.y = Math.PI / 4;
    r.scale.set(1, 1, 0.85);
    if (broken) r.rotation.z = 0.08; // sagging roof
    g.add(r);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2, 0.1), ps1Material("door", snapRes, { color: broken ? "#2a2018" : "#6b3b1c" }));
    door.position.set(0, 1, 2.51);
    g.add(door);
    g.position.set(0, 0, -6);
    return g;
  };
  const old = makeHouse(mat("oldPlank", tex.oldPlank()), ps1Material("roofOld", snapRes, { map: tex.roofTile(), color: "#8a8a8a" }), true);
  const repaired = makeHouse(mat("newPlank", tex.newPlank()), mat("roof", tex.roofTile()), false);
  repaired.visible = false;
  scene.add(old, repaired);

  // Field plots (3 x 2), positions matter for interaction later.
  const plotGeo = new THREE.BoxGeometry(1.6, 0.2, 1.6);
  const soil = mat("soil", tex.soil());
  const plots: THREE.Mesh[] = [];
  for (let i = 0; i < LIMITS.plotCount; i++) {
    const m = new THREE.Mesh(plotGeo, soil);
    m.position.set(6 + (i % 3) * 2, 0.1, 1 + Math.floor(i / 3) * 2);
    scene.add(m);
    plots.push(m);
  }

  // Tree
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 5), mat("bark", tex.bark()));
  trunk.position.set(-6, 1, 0);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), mat("leaves", tex.leaves()));
  crown.position.set(-6, 2.8, 0);
  scene.add(trunk, crown);

  // Player: a few boxes, readable silhouette from the follow camera.
  const player = new THREE.Group();
  const cloth = mat("cloth", tex.cloth());
  const skin = ps1Material("skin", snapRes, { color: "#e0b48a" });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.35), cloth);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), skin);
  head.position.y = 1.75;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), ps1Material("pants", snapRes, { color: "#3b3328" }));
  legs.position.y = 0.35;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), skin);
  nose.position.set(0, 1.75, 0.27);
  player.add(torso, head, legs, nose);
  scene.add(player);

  return { scene, player, house: { old, repaired }, plots };
}
