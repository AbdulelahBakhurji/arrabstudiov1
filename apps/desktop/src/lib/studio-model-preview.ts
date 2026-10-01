/**
 * Studio 3D Modeling — advanced WebGL viewport helpers.
 * Mesh preview, materials, lights, shading modes, create presets.
 */
import type { StudioFile } from "@/lib/studio-catalog";
import { buildPreviewHtml } from "@/lib/studio-catalog";

export type ModelShadingMode = "solid" | "wire" | "material" | "rendered";
export type ModelPreviewQuality = "high" | "balanced" | "performance";
export type ModelCameraKind = "persp" | "ortho";

export type ModelPreviewOptions = {
  quality?: ModelPreviewQuality;
  showGrid?: boolean;
  showAxes?: boolean;
  shading?: ModelShadingMode;
  cameraKind?: ModelCameraKind;
  matcap?: boolean;
  paused?: boolean;
  emptyDemo?: boolean;
};

export type ModelGenre =
  | "product"
  | "character"
  | "architecture"
  | "prop"
  | "sculpt"
  | "vehicle"
  | "environment";

export type ModelCreatePreset = {
  id: ModelGenre;
  label: string;
  labelAr: string;
  blurb: string;
  blurbAr: string;
  prompt: string;
  promptAr: string;
};

export const MODEL_CREATE_PRESETS: ModelCreatePreset[] = [
  {
    id: "product",
    label: "Product shot",
    labelAr: "تصوير منتج",
    blurb: "Studio light · metal / glass · turntable",
    blurbAr: "إضاءة استوديو · معدن/زجاج · دوران",
    prompt: "Model a premium product for studio lighting with metal and glass materials on a turntable",
    promptAr: "صمّم منتجاً فاخراً بإضاءة استوديو ومواد معدن وزجاج على قاعدة دوّارة",
  },
  {
    id: "character",
    label: "Character blockout",
    labelAr: "شخصية كتلية",
    blurb: "Humanoid volumes · proportions",
    blurbAr: "أحجام بشرية · نسب",
    prompt: "Block out a stylized humanoid character with clean proportions for 3D modeling",
    promptAr: "ابنِ شخصية بشرية كتلية بنسب نظيفة للنمذجة ثلاثية الأبعاد",
  },
  {
    id: "architecture",
    label: "Architecture",
    labelAr: "عمارة",
    blurb: "Room / pavilion · scale grid",
    blurbAr: "غرفة / جناح · شبكة مقياس",
    prompt: "Model a modern pavilion interior with walls, openings, and architectural scale",
    promptAr: "نمذج جناحاً معمارياً حديثاً بجدران وفتحات ومقياس معماري",
  },
  {
    id: "prop",
    label: "Hard-surface prop",
    labelAr: "دعامة صلبة",
    blurb: "Tool / gadget · bevels",
    blurbAr: "أداة / جهاز · حواف",
    prompt: "Create a hard-surface gadget prop with beveled edges and panel cuts",
    promptAr: "أنشئ دعامة جهاز بسطح صلب وحواف مشطوفة وقطع لوحات",
  },
  {
    id: "sculpt",
    label: "Organic sculpt",
    labelAr: "نحت عضوي",
    blurb: "Soft forms · subdivision feel",
    blurbAr: "أشكال ناعمة · إحساس تقسيم",
    prompt: "Sculpt an organic abstract form with smooth subdivision-style surfaces",
    promptAr: "انحت شكلاً عضوياً مجرداً بأسطح ناعمة كالتقسيم",
  },
  {
    id: "vehicle",
    label: "Vehicle blockout",
    labelAr: "مركبة كتلية",
    blurb: "Car volumes · wheels",
    blurbAr: "أحجام سيارة · عجلات",
    prompt: "Block out a futuristic vehicle with body, cabin, and wheels for 3D modeling",
    promptAr: "ابنِ مركبة مستقبلية كتلية بهيكل وكابينة وعجلات للنمذجة",
  },
  {
    id: "environment",
    label: "Environment kit",
    labelAr: "طقم بيئة",
    blurb: "Terrain · rocks · foliage proxies",
    blurbAr: "تضاريس · صخور · نباتات وسيطة",
    prompt: "Build an environment kit with terrain plate, rocks, and simple foliage proxies",
    promptAr: "ابنِ طقم بيئة بقاعدة تضاريس وصخور ونباتات وسيطة بسيطة",
  },
];

const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.170.0";

export function detectModelGenre(prompt: string): ModelGenre {
  const text = prompt.toLowerCase();
  if (/character|human|شخص|بشر|hero|avatar/i.test(text)) return "character";
  if (/architect|room|pavilion|building|عمار|غرفة|جناح|interior/i.test(text)) return "architecture";
  if (/prop|gadget|tool|weapon|دعام|جهاز|أداة/i.test(text)) return "prop";
  if (/sculpt|organic|نحت|عضوي|blob/i.test(text)) return "sculpt";
  if (/vehicle|car|bike|مركبة|سيارة|truck/i.test(text)) return "vehicle";
  if (/environment|terrain|landscape|بيئة|تضاريس|rock/i.test(text)) return "environment";
  return "product";
}

export function localModelFromPrompt(prompt: string): StudioFile[] {
  const title = prompt.trim().slice(0, 48) || "Arrab Model";
  const genre = detectModelGenre(prompt);
  return [
    {
      path: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="styles.css" />
  <script type="importmap">
  {
    "imports": {
      "three": "${THREE_CDN}/build/three.module.js",
      "three/addons/": "${THREE_CDN}/examples/jsm/"
    }
  }
  </script>
</head>
<body>
  <canvas id="viewport"></canvas>
  <div id="hud">
    <div class="hud-lead">
      <strong>${escapeHtml(title)}</strong>
      <span id="genre">${genre}</span>
    </div>
    <div class="hud-stats">
      <em id="shading">Material</em>
      <em id="mesh">—</em>
      <em id="fps">— FPS</em>
    </div>
    <p id="tips">Orbit drag · Scroll zoom · G grid · 1–4 shading · Tab wire</p>
  </div>
  <div id="vignette"></div>
  <script type="module" src="model.js"></script>
</body>
</html>`,
    },
    {
      path: "styles.css",
      content: `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#1a1a1a;font-family:ui-sans-serif,system-ui,sans-serif}
#viewport{display:block;width:100%;height:100%}
#vignette{pointer-events:none;position:fixed;inset:0;box-shadow:inset 0 0 100px rgba(0,0,0,.5);z-index:1}
#hud{position:fixed;inset:14px 14px auto 14px;z-index:2;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;
padding:12px 14px;border-radius:14px;background:rgba(20,20,22,.82);border:1px solid rgba(255,140,66,.28);
backdrop-filter:blur(14px);color:#f3f0ea;font-size:12px;pointer-events:none}
.hud-lead{display:flex;flex-direction:column;gap:4px;min-width:140px}
.hud-lead strong{font-size:14px;letter-spacing:.02em}
#genre{display:inline-flex;align-self:flex-start;padding:2px 8px;border-radius:999px;font-size:10px;letter-spacing:.06em;
text-transform:uppercase;color:#ffd0a8;border:1px solid rgba(255,140,66,.4);background:rgba(120,50,10,.35)}
.hud-stats{margin-inline-start:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-variant-numeric:tabular-nums}
#shading,#mesh,#fps{font-style:normal;opacity:.92}
#shading{color:#ffb16a;font-weight:650}
#mesh{color:#d6d3d1}
#fps{color:#93c5fd}
#tips{width:100%;opacity:.68;font-size:11px;margin:0}`,
    },
    {
      path: "model.js",
      content: advancedModelJs(title, genre),
    },
    {
      path: "README.md",
      content: `# ${title}

Arrab Studio 3D modeling project (${genre}).

- \`index.html\` — advanced viewport shell
- \`styles.css\` — full-bleed layout
- \`model.js\` — Three.js modeling scene

Orbit to inspect. Studio shading modes: Solid / Wire / Material / Rendered.
`,
    },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function advancedModelJs(title: string, genre: ModelGenre): string {
  const safeTitle = title.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GENRE = '${genre}';
const canvas = document.getElementById('viewport');
const fpsEl = document.getElementById('fps');
const meshEl = document.getElementById('mesh');
const shadingEl = document.getElementById('shading');
const tipsEl = document.getElementById('tips');
const cfg = () => window.__ARRAB_MODEL__ || {
  quality: 'high', showGrid: true, showAxes: true, shading: 'material',
  cameraKind: 'persp', matcap: false, paused: false
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a2e);
scene.fog = new THREE.Fog(0x2a2a2e, 18, 55);

const persp = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
persp.position.set(4.8, 3.4, 6.2);
const ortho = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 200);
ortho.position.copy(persp.position);
let camera = persp;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.0, 0);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.2;
controls.maxDistance = 40;

const hemi = new THREE.HemisphereLight(0xf0f4ff, 0x3a2a1a, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2df, 1.55);
key.position.set(5, 8, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 10;
key.shadow.camera.bottom = -10;
scene.add(key);
const fill = new THREE.DirectionalLight(0xb7d4ff, 0.45);
fill.position.set(-6, 3, -2);
scene.add(fill);
const rim = new THREE.PointLight(0xff8c42, 0.9, 24, 2);
rim.position.set(-2, 3.5, 5);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(18, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.92, metalness: 0.05 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(20, 20, 0x666670, 0x3d3d44);
grid.position.y = 0.01;
scene.add(grid);
const axes = new THREE.AxesHelper(2.2);
axes.position.y = 0.02;
scene.add(axes);

const root = new THREE.Group();
scene.add(root);
const mats = [];
function track(mat) { mats.push(mat); return mat; }

function std(color, opts = {}) {
  return track(new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.45, metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: Boolean(opts.transparent), opacity: opts.opacity ?? 1,
  }));
}

function addMesh(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

const chrome = std(0xd0d4dc, { roughness: 0.18, metalness: 0.92 });
const matte = std(0xe8e2d8, { roughness: 0.78, metalness: 0.05 });
const accent = std(0xff8c42, { roughness: 0.35, metalness: 0.35, emissive: 0x5c2a0a, emissiveIntensity: 0.25 });
const glass = std(0xa8d8ff, { roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.45 });
const dark = std(0x222228, { roughness: 0.55, metalness: 0.4 });

if (GENRE === 'product') {
  addMesh(new THREE.CylinderGeometry(0.9, 1.05, 0.18, 48), dark, 0, 0.09, 0);
  const body = addMesh(new THREE.CapsuleGeometry(0.55, 1.1, 10, 28), chrome, 0, 1.15, 0);
  body.rotation.z = Math.PI / 2;
  addMesh(new THREE.TorusGeometry(0.62, 0.06, 16, 48), accent, 0, 1.15, 0);
  addMesh(new THREE.SphereGeometry(0.28, 32, 24), glass, 0.55, 1.35, 0.15);
} else if (GENRE === 'character') {
  addMesh(new THREE.SphereGeometry(0.38, 28, 20), matte, 0, 2.25, 0);
  addMesh(new THREE.CapsuleGeometry(0.42, 0.9, 8, 16), matte, 0, 1.35, 0);
  addMesh(new THREE.CapsuleGeometry(0.14, 0.7, 6, 10), matte, -0.62, 1.45, 0, 1, 1, 1);
  addMesh(new THREE.CapsuleGeometry(0.14, 0.7, 6, 10), matte, 0.62, 1.45, 0, 1, 1, 1);
  addMesh(new THREE.CapsuleGeometry(0.16, 0.75, 6, 10), dark, -0.22, 0.55, 0);
  addMesh(new THREE.CapsuleGeometry(0.16, 0.75, 6, 10), dark, 0.22, 0.55, 0);
  addMesh(new THREE.BoxGeometry(0.55, 0.12, 0.35), accent, 0, 1.75, 0.28);
} else if (GENRE === 'architecture') {
  addMesh(new THREE.BoxGeometry(6, 0.12, 5), dark, 0, 0.06, 0);
  addMesh(new THREE.BoxGeometry(0.18, 2.4, 5), matte, -3, 1.2, 0);
  addMesh(new THREE.BoxGeometry(0.18, 2.4, 5), matte, 3, 1.2, 0);
  addMesh(new THREE.BoxGeometry(6, 2.4, 0.18), matte, 0, 1.2, -2.4);
  addMesh(new THREE.BoxGeometry(6, 0.14, 5.2), chrome, 0, 2.45, 0);
  addMesh(new THREE.BoxGeometry(1.6, 2.0, 0.12), glass, 0, 1.05, 2.35);
  addMesh(new THREE.BoxGeometry(0.9, 0.08, 1.6), accent, 1.4, 0.45, 0.8);
} else if (GENRE === 'prop') {
  addMesh(new THREE.BoxGeometry(1.8, 0.35, 0.7), dark, 0, 0.55, 0);
  addMesh(new THREE.BoxGeometry(1.5, 0.18, 0.55), chrome, 0, 0.82, 0);
  addMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 20), accent, -0.55, 0.55, 0.55);
  addMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 20), accent, 0.55, 0.55, 0.55);
  addMesh(new THREE.BoxGeometry(0.4, 0.25, 0.25), glass, 0.7, 0.95, 0);
} else if (GENRE === 'sculpt') {
  const soft = std(0xf2c6a0, { roughness: 0.62, metalness: 0.08 });
  addMesh(new THREE.IcosahedronGeometry(1.15, 3), soft, 0, 1.25, 0);
  addMesh(new THREE.TorusKnotGeometry(0.55, 0.16, 120, 16), accent, 0, 1.35, 0);
} else if (GENRE === 'vehicle') {
  addMesh(new THREE.BoxGeometry(2.6, 0.55, 1.2), chrome, 0, 0.7, 0);
  addMesh(new THREE.BoxGeometry(1.4, 0.45, 1.05), glass, -0.15, 1.15, 0);
  addMesh(new THREE.BoxGeometry(0.7, 0.25, 1.15), dark, 1.05, 0.85, 0);
  for (const [x, z] of [[-0.85, 0.7], [0.85, 0.7], [-0.85, -0.7], [0.85, -0.7]]) {
    const wheel = addMesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 24), dark, x, 0.32, z);
    wheel.rotation.z = Math.PI / 2;
  }
  addMesh(new THREE.BoxGeometry(0.2, 0.08, 0.9), accent, -1.2, 0.72, 0);
} else {
  addMesh(new THREE.CylinderGeometry(4, 5.5, 0.35, 48), dark, 0, 0.1, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    addMesh(new THREE.DodecahedronGeometry(0.35 + (i % 3) * 0.12, 0), matte, Math.cos(a) * 2.4, 0.55, Math.sin(a) * 2.4);
  }
  for (let i = 0; i < 5; i++) {
    addMesh(new THREE.ConeGeometry(0.18, 0.9, 8), accent, (i - 2) * 0.7, 0.7, -2.8);
  }
}

const turntable = GENRE === 'product' || GENRE === 'prop' || GENRE === 'sculpt';
let composer = null;
let bloom = null;
try {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.55, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
} catch (err) {
  console.warn('Arrab model post-FX unavailable', err);
  composer = null;
  bloom = null;
}

const state = { shading: 'material', paused: false, rendered: true };
function countMesh() {
  let verts = 0, faces = 0, objs = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    objs += 1;
    const g = o.geometry;
    verts += g.attributes.position?.count || 0;
    const idx = g.index ? g.index.count : (g.attributes.position?.count || 0);
    faces += Math.floor(idx / 3);
  });
  return { verts, faces, objs };
}
const meshStats = countMesh();
if (meshEl) meshEl.textContent = meshStats.objs + ' obj · ' + meshStats.faces + ' faces · ' + meshStats.verts + ' verts';

function applyShading(mode) {
  state.shading = mode || 'material';
  const wire = state.shading === 'wire';
  const solid = state.shading === 'solid';
  for (const mat of mats) {
    if ('wireframe' in mat) mat.wireframe = wire;
    if (solid) {
      if ('roughness' in mat) { mat.userData._r = mat.roughness; mat.roughness = 1; }
      if ('metalness' in mat) { mat.userData._m = mat.metalness; mat.metalness = 0; }
      if ('emissiveIntensity' in mat) mat.emissiveIntensity = 0;
    } else {
      if (mat.userData._r != null) mat.roughness = mat.userData._r;
      if (mat.userData._m != null) mat.metalness = mat.userData._m;
    }
  }
  hemi.intensity = state.shading === 'rendered' ? 0.7 : 0.55;
  key.intensity = state.shading === 'rendered' ? 1.85 : state.shading === 'solid' ? 0.9 : 1.45;
  if (bloom) bloom.strength = state.shading === 'rendered' ? 0.42 : 0.18;
  state.rendered = state.shading === 'rendered' || state.shading === 'material';
  if (shadingEl) shadingEl.textContent = state.shading[0].toUpperCase() + state.shading.slice(1);
  if (tipsEl) {
    tipsEl.textContent = 'Orbit · Zoom · Shading: ' + state.shading + ' · Advanced viewport · ' + '${safeTitle}';
  }
}

function applyStudioControls(next) {
  const quality = next?.quality || 'high';
  const pr = quality === 'performance' ? 1 : quality === 'balanced' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = quality !== 'performance';
  key.castShadow = quality !== 'performance';
  grid.visible = next?.showGrid !== false;
  axes.visible = next?.showAxes !== false;
  state.paused = Boolean(next?.paused);
  const kind = next?.cameraKind || 'persp';
  if (kind === 'ortho' && camera !== ortho) {
    ortho.position.copy(camera.position);
    camera = ortho;
    controls.object = camera;
  } else if (kind !== 'ortho' && camera !== persp) {
    persp.position.copy(camera.position);
    camera = persp;
    controls.object = camera;
  }
  applyShading(next?.shading || state.shading);
}

applyStudioControls(cfg());
if (typeof window.__ARRAB_REGISTER_MODEL__ === 'function') {
  window.__ARRAB_REGISTER_MODEL__({ renderer, scene, camera, composer, apply: applyStudioControls });
}
addEventListener('arrab-model-control', (event) => applyStudioControls(event.detail || cfg()));

addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') applyShading('solid');
  if (e.code === 'Digit2') applyShading('wire');
  if (e.code === 'Digit3') applyShading('material');
  if (e.code === 'Digit4') applyShading('rendered');
  if (e.code === 'KeyG') { grid.visible = !grid.visible; }
  if (e.code === 'Tab') { e.preventDefault(); applyShading(state.shading === 'wire' ? 'material' : 'wire'); }
});

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  const fr = 4 * (h / w);
  ortho.left = -4; ortho.right = 4; ortho.top = fr; ortho.bottom = -fr;
  ortho.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
});

const clock = new THREE.Clock();
let frames = 0;
let lastFps = performance.now();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.paused) {
    if (turntable) root.rotation.y += dt * 0.35;
    root.children.forEach((child, i) => {
      if (GENRE === 'sculpt' && child.isMesh) child.rotation.y += dt * (0.15 + i * 0.05);
    });
  }
  controls.update();
  if (state.rendered && composer && cfg().quality !== 'performance') composer.render();
  else renderer.render(scene, camera);
  frames += 1;
  const now = performance.now();
  if (now - lastFps >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastFps));
    frames = 0; lastFps = now;
    if (fpsEl) fpsEl.textContent = fps + ' FPS';
    parent.postMessage({
      type: 'arrab-model-stats',
      fps,
      objects: meshStats.objs,
      faces: meshStats.faces,
      verts: meshStats.verts,
      shading: state.shading,
    }, '*');
  }
  requestAnimationFrame(frame);
}
frame();
`;
}

export function emptyModelDemoHtml(ar: boolean): string {
  const title = ar ? "استوديو النمذجة المتقدم" : "Arrab Advanced Modeling";
  return buildModelPreviewHtml(localModelFromPrompt(title), {
    emptyDemo: true,
    quality: "high",
    showGrid: true,
    showAxes: true,
    shading: "material",
  });
}

export function enhanceModelPreviewHtml(html: string, options: ModelPreviewOptions = {}): string {
  let next = html;
  const quality = options.quality ?? "high";
  if (!/importmap/i.test(next)) {
    const importMap = `<script type="importmap">
{"imports":{"three":"${THREE_CDN}/build/three.module.js","three/addons/":"${THREE_CDN}/examples/jsm/"}}
</script>`;
    if (/<\/head>/i.test(next)) next = next.replace(/<\/head>/i, `${importMap}\n</head>`);
    else next = `${importMap}${next}`;
  }
  const bridge = `<script>
window.__ARRAB_MODEL__ = {
  quality: ${JSON.stringify(quality)},
  showGrid: ${options.showGrid !== false},
  showAxes: ${options.showAxes !== false},
  shading: ${JSON.stringify(options.shading ?? "material")},
  cameraKind: ${JSON.stringify(options.cameraKind ?? "persp")},
  matcap: ${Boolean(options.matcap)},
  paused: ${Boolean(options.paused)}
};
window.__ARRAB_REGISTER_MODEL__ = function (runtime) {
  window.__ARRAB_MODEL_RUNTIME__ = runtime;
  if (runtime && typeof runtime.apply === 'function') runtime.apply(window.__ARRAB_MODEL__);
};
addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'arrab-model-control') return;
  window.__ARRAB_MODEL__ = { ...window.__ARRAB_MODEL__, ...data.payload };
  const runtime = window.__ARRAB_MODEL_RUNTIME__;
  if (runtime && typeof runtime.apply === 'function') runtime.apply(window.__ARRAB_MODEL__);
  dispatchEvent(new CustomEvent('arrab-model-control', { detail: window.__ARRAB_MODEL__ }));
});
</script>`;
  if (/<\/body>/i.test(next)) next = next.replace(/<\/body>/i, `${bridge}\n</body>`);
  else next = `${next}${bridge}`;
  return next;
}

export function buildModelPreviewHtml(files: StudioFile[], options: ModelPreviewOptions = {}): string {
  const withAlias: StudioFile[] = [...files];
  const model = withAlias.find((file) => file.path === "model.js");
  if (model && !withAlias.some((file) => file.path === "app.js")) {
    withAlias.push({ path: "app.js", content: model.content });
  }
  let html = buildPreviewHtml(withAlias);
  if (model && /<script[^>]+src=["']model\.js["']/i.test(html)) {
    html = html.replace(
      /<script[^>]+src=["']model\.js["'][^>]*>\s*<\/script>/i,
      `<script type="module">\n${model.content}\n</script>`,
    );
  }
  return enhanceModelPreviewHtml(html, options);
}
