import * as THREE from "three";

/** Internal render height in pixels. The canvas is upscaled with nearest-neighbour filtering. */
export const RENDER_HEIGHT = 240;

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas.style.imageRendering = "pixelated";

  const snapRes = new THREE.Vector2(320, RENDER_HEIGHT);

  function resize(camera: THREE.PerspectiveCamera) {
    const aspect = window.innerWidth / window.innerHeight;
    const h = RENDER_HEIGHT;
    const w = Math.round(h * aspect);
    renderer.setSize(w, h, false); // low internal resolution
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    snapRes.set(w, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  return { renderer, resize, snapRes };
}

/**
 * Lambert material with PS1-style vertex snapping (vertices jump between
 * screen pixels, giving the characteristic "wobble"). Materials are cached
 * by key so meshes share them.
 */
const matCache = new Map<string, THREE.MeshLambertMaterial>();

export function ps1Material(key: string, snapRes: THREE.Vector2, params: THREE.MeshLambertMaterialParameters) {
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshLambertMaterial({ flatShading: true, ...params });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = { value: snapRes };
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform vec2 uSnapRes;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 snapped = gl_Position;
        snapped.xyz /= snapped.w;
        snapped.xy = floor(snapped.xy * uSnapRes * 0.5) / (uSnapRes * 0.5);
        snapped.xyz *= snapped.w;
        gl_Position = snapped;`,
      );
  };
  matCache.set(key, m);
  return m;
}
