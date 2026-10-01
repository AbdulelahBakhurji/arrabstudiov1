/**
 * Studio Game Design — advanced WebGL / Three.js preview helpers.
 * Demo arena: playable loop, collectibles, camera modes, bloom, day cycle.
 */
import type { StudioFile } from "@/lib/studio-catalog";
import { buildPreviewHtml } from "@/lib/studio-catalog";

export type GamePreviewQuality = "high" | "balanced" | "performance";
export type GameCameraMode = "orbit" | "follow" | "chase";
export type GameTimeOfDay = "dawn" | "noon" | "dusk" | "night";

export type GamePreviewOptions = {
  quality?: GamePreviewQuality;
  showGrid?: boolean;
  showAxes?: boolean;
  wireframe?: boolean;
  postFx?: boolean;
  paused?: boolean;
  cameraMode?: GameCameraMode;
  timeOfDay?: GameTimeOfDay;
  emptyDemo?: boolean;
};

const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.170.0";

export type GameGenre = "arena" | "platformer" | "maze" | "race" | "flyer" | "defense";

export type GameCreatePreset = {
  id: GameGenre;
  prompt: string;
  promptAr: string;
  label: string;
  labelAr: string;
  blurb: string;
  blurbAr: string;
};

export const GAME_CREATE_PRESETS: GameCreatePreset[] = [
  {
    id: "arena",
    label: "Crystal arena",
    labelAr: "ساحة بلورية",
    blurb: "Collect crystals · bloom · follow cam",
    blurbAr: "اجمع البلورات · Bloom · كاميرا متابعة",
    prompt: "Build an advanced crystal arena with bloom lighting, jump, score, and follow camera",
    promptAr: "ابنِ ساحة بلورية متقدمة مع إضاءة Bloom وقفز ونقاط وكاميرا متابعة",
  },
  {
    id: "platformer",
    label: "Sky platforms",
    labelAr: "منصات سماوية",
    blurb: "3D jump pads · floating lanes",
    blurbAr: "منصات قفز · ممرات عائمة",
    prompt: "Create a 3D sky platformer with floating pads, high jumps, and crystal collectibles",
    promptAr: "أنشئ منصات قفز ثلاثية مع منصات عائمة وقفز عالٍ وجمع بلورات",
  },
  {
    id: "maze",
    label: "Night maze",
    labelAr: "متاهة ليلية",
    blurb: "Walls · night fog · chase cam",
    blurbAr: "جدران · ضباب ليلي · كاميرا مطاردة",
    prompt: "Design a night maze with tall walls, fog, chase camera, and hidden crystals",
    promptAr: "صمّم متاهة ليلية بجدران عالية وضباب وكاميرا مطاردة وبلورات مخفية",
  },
  {
    id: "race",
    label: "Neon race",
    labelAr: "سباق نيون",
    blurb: "Speed track · gates · dusk",
    blurbAr: "مسار سريع · بوابات · غروب",
    prompt: "Build a neon race track with speed boosts, gates, and dusk lighting",
    promptAr: "ابنِ مسار سباق نيون مع تسارع وبوابات وإضاءة غروب",
  },
  {
    id: "flyer",
    label: "Sky flyer",
    labelAr: "طيران سماوي",
    blurb: "Free flight · rings · stars",
    blurbAr: "طيران حر · حلقات · نجوم",
    prompt: "Make a sky flyer with free flight, glowing rings to collect, and starfield",
    promptAr: "اصنع طيراناً سماوياً مع حركة حرة وحلقات مضيئة للجمع وحقل نجوم",
  },
  {
    id: "defense",
    label: "Orb defense",
    labelAr: "دفاع المدارات",
    blurb: "Survive waves · dodge orbs",
    blurbAr: "نجاة من موجات · تفادَ المدارات",
    prompt: "Create an orb defense arena where hostile orbs hunt the player and crystals restore score",
    promptAr: "أنشئ ساحة دفاع بمدارات معادية تطارد اللاعب وبلورات تعيد النقاط",
  },
];

export function detectGameGenre(prompt: string): GameGenre {
  const text = prompt.toLowerCase();
  if (/maze|متاه|labyrinth|crystal maze/i.test(text)) return "maze";
  if (/platform|منصة|jump|قفز|side.?scroll/i.test(text)) return "platformer";
  if (/race|سباق|drive|قيادة|track|neon race/i.test(text)) return "race";
  if (/fly|طيران|flyer|sky flyer|rings|حلقات/i.test(text)) return "flyer";
  if (/defense|دفاع|survive|نجاة|orb|مدارات|wave|موج/i.test(text)) return "defense";
  return "arena";
}

export function isRobloxPrompt(prompt: string): boolean {
  return /roblox|روبلوكس|luau|\.rbxl|rojo|rbx/i.test(prompt);
}

export function isRobloxProject(files: StudioFile[]): boolean {
  return files.some(
    (file) =>
      /\.(lua|luau)$/i.test(file.path) ||
      /default\.project\.json$/i.test(file.path) ||
      /wally\.toml$/i.test(file.path),
  );
}

export function isBrowserGameProject(files: StudioFile[]): boolean {
  return files.some(
    (file) =>
      /(^|\/)(game|app)\.js$/i.test(file.path) ||
      /(^|\/)index\.html$/i.test(file.path),
  );
}

/** Rojo-style Roblox project scaffold — files for Studio / open folder, not WebGL preview. */
export function localRobloxFromPrompt(prompt: string): StudioFile[] {
  const title = prompt.trim().slice(0, 48) || "Arrab Roblox Experience";
  const safe = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    {
      path: "default.project.json",
      content: `{
  "name": "${safe}",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "Shared": {
        "$path": "src/shared"
      }
    },
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "Server": {
        "$path": "src/server"
      }
    },
    "StarterPlayer": {
      "$className": "StarterPlayer",
      "StarterPlayerScripts": {
        "$className": "StarterPlayerScripts",
        "Client": {
          "$path": "src/client"
        }
      }
    }
  }
}
`,
    },
    {
      path: "src/server/init.server.luau",
      content: `-- ${title}
-- Server bootstrap (Arrab Studio)

local Players = game:GetService("Players")

print("[Arrab] Server ready for: ${safe}")

Players.PlayerAdded:Connect(function(player)
	print("[Arrab] Player joined:", player.Name)
end)
`,
    },
    {
      path: "src/client/init.client.luau",
      content: `-- ${title}
-- Client bootstrap (Arrab Studio)

local Players = game:GetService("Players")
local player = Players.LocalPlayer

print("[Arrab] Client ready for", player.Name)
`,
    },
    {
      path: "src/shared/Hello.luau",
      content: `-- Shared module
local Hello = {}

function Hello.greet(name: string): string
	return ("Welcome to ${safe}, %s"):format(name)
end

return Hello
`,
    },
    {
      path: "README.md",
      content: `# ${title}

Roblox experience scaffold from Arrab Studio (Rojo-style).

1. Open this folder in your editor or sync with Rojo.
2. Open the place in Roblox Studio.
3. Ask Majed to add systems, UI, remotes, datastores, and gameplay loops.

Files live in the Studio Code tree and any connected workspace folder.
`,
    },
  ];
}

export function presetForGenre(genre: GameGenre): GameCreatePreset {
  return GAME_CREATE_PRESETS.find((item) => item.id === genre) ?? GAME_CREATE_PRESETS[0]!;
}

/** Starter playable 3D project when the operator asks before files exist. */
export function localGameFromPrompt(prompt: string): StudioFile[] {
  const title = prompt.trim().slice(0, 48) || "Arrab Arena";
  const genre = detectGameGenre(prompt);
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
  <canvas id="game"></canvas>
  <div id="hud">
    <div class="hud-lead">
      <strong>${escapeHtml(title)}</strong>
      <span id="genre">${genre}</span>
    </div>
    <div class="hud-stats">
      <em id="score">0</em>
      <em id="fps">— FPS</em>
    </div>
    <p id="tips">WASD move · Space jump/up · Shift down (flyer) · Drag orbit · Collect</p>
  </div>
  <div id="vignette"></div>
  <script type="module" src="game.js"></script>
</body>
</html>`,
    },
    {
      path: "styles.css",
      content: `*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#05070d;font-family:ui-sans-serif,system-ui,sans-serif}
#game{display:block;width:100%;height:100%}
#vignette{pointer-events:none;position:fixed;inset:0;box-shadow:inset 0 0 120px rgba(0,0,0,.55);z-index:1}
#hud{position:fixed;inset:16px 16px auto 16px;z-index:2;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-end;
padding:14px 16px;border-radius:16px;background:rgba(6,10,18,.78);border:1px solid rgba(94,234,212,.22);
backdrop-filter:blur(14px);color:#e8eefc;font-size:12px;pointer-events:none}
.hud-lead{display:flex;flex-direction:column;gap:4px;min-width:140px}
.hud-lead strong{font-size:14px;letter-spacing:.02em}
#genre{display:inline-flex;align-self:flex-start;padding:2px 8px;border-radius:999px;font-size:10px;letter-spacing:.06em;
text-transform:uppercase;color:#99f6e4;border:1px solid rgba(45,212,191,.35);background:rgba(15,118,110,.25)}
.hud-stats{margin-inline-start:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-variant-numeric:tabular-nums}
#score{font-style:normal;font-size:18px;font-weight:650;color:#5eead4}
#fps{font-style:normal;color:#7dd3fc;opacity:.9}
#tips{width:100%;opacity:.7;font-size:11px;margin:0}`,
    },
    {
      path: "game.js",
      content: advancedDemoGameJs(title, genre),
    },
    {
      path: "README.md",
      content: `# ${title}

Arrab Studio game project (${genre}).

- \`index.html\` — canvas + HUD shell
- \`styles.css\` — full-bleed layout
- \`game.js\` — Three.js playable loop

Controls: WASD / arrows, Space jump, drag to orbit.
Studio preview supports quality, grid, axes, wireframe, bloom, camera modes, and day cycle.
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

function advancedDemoGameJs(title: string, genre: GameGenre): string {
  const safeTitle = title.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GENRE = '${genre}';
const canvas = document.getElementById('game');
const fpsEl = document.getElementById('fps');
const scoreEl = document.getElementById('score');
const tipsEl = document.getElementById('tips');
const cfg = () => window.__ARRAB_GAME__ || {
  quality: 'high', showGrid: true, showAxes: false, wireframe: false,
  postFx: true, paused: false, cameraMode: 'follow', timeOfDay: 'dusk'
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081018);
scene.fog = new THREE.FogExp2(0x081018, 0.028);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 240);
camera.position.set(7.2, 4.6, 9.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 28;
controls.target.set(0, 1.1, 0);

const hemi = new THREE.HemisphereLight(0xb7d7ff, 0x1b1510, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 1.45);
sun.position.set(9, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
scene.add(sun);
const rim = new THREE.PointLight(0x5eead4, 1.2, 28, 2);
rim.position.set(-4, 3.5, 5);
scene.add(rim);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(90, 32, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x163055) },
      bottomColor: { value: new THREE.Color(0x070b14) },
      offset: { value: 8 },
      exponent: { value: 0.55 },
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 p = modelMatrix * vec4(position,1.0); vW = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
    fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vW; void main(){ float h = normalize(vW + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent),0.0)), 1.0); }',
  })
);
scene.add(sky);

const stars = new THREE.Points(
  (() => {
    const g = new THREE.BufferGeometry();
    const n = 420;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 40 + Math.random() * 40;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1) * 0.45;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph));
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  })(),
  new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.12, transparent: true, opacity: 0.85, depthAttenuation: true })
);
scene.add(stars);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(32, 72),
  new THREE.MeshStandardMaterial({ color: 0x152033, roughness: 0.9, metalness: 0.12 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(10.5, 11.1, 64),
  new THREE.MeshStandardMaterial({ color: 0x2dd4bf, emissive: 0x0f766e, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.5 })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.03;
scene.add(ring);

const grid = new THREE.GridHelper(44, 44, 0x3a6ea5, 0x1c2a40);
grid.position.y = 0.02;
scene.add(grid);

const axes = new THREE.AxesHelper(3.4);
axes.position.y = 0.04;
axes.visible = false;
scene.add(axes);

const playerMat = new THREE.MeshStandardMaterial({
  color: 0x5eead4, roughness: 0.28, metalness: 0.45, emissive: 0x115e59, emissiveIntensity: 0.35,
});
const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.95, 8, 16), playerMat);
player.position.set(0, 1.08, 0);
player.castShadow = true;
scene.add(player);
const playerGlow = new THREE.PointLight(0x5eead4, 0.75, 5, 2);
player.add(playerGlow);
playerGlow.position.set(0, 0.4, 0);

const platforms = [];
const platformSpecs = GENRE === 'platformer'
  ? [[-3.5, 0.9, -1.2, 2.6], [-1.2, 1.7, -3.4, 2.2], [2.4, 2.4, -2.2, 2.4], [5.2, 3.1, 0.4, 2.0], [-5.5, 1.2, 2.5, 2.8], [0.8, 3.8, 2.8, 1.8], [-2.8, 4.4, -0.6, 1.6]]
  : GENRE === 'maze'
    ? [[-4, 0.9, 0, 1.2], [-2, 0.9, -3, 1.2], [1.5, 0.9, -4, 1.2], [4, 0.9, -1, 1.2], [3, 0.9, 3, 1.2], [-1, 0.9, 4, 1.2], [-5, 0.9, 3, 1.2], [0, 0.9, 0, 1.0], [5.5, 0.9, 2.2, 1.1]]
    : GENRE === 'race'
      ? [[0, 0.2, -8, 4.5], [0, 0.2, -14, 4.5], [3.5, 0.2, -10, 2.2], [-3.5, 0.2, -12, 2.2], [0, 0.2, -20, 5.2], [2.8, 0.2, -17, 2.0]]
      : GENRE === 'flyer'
        ? [[-6, 4.5, -4, 2.4], [4, 6.2, -8, 2.0], [0, 8.5, -12, 2.6], [7, 5.0, -2, 1.8], [-5, 7.0, -10, 2.2]]
        : GENRE === 'defense'
          ? [[-5, 0.55, -3, 2.8], [5, 0.55, -3, 2.8], [0, 0.55, 5, 3.2], [-4, 1.2, 3, 2.0], [4, 1.2, 3, 2.0]]
          : [[-4.8, 0.55, -2.4, 3.2], [5.2, 1.1, 1.5, 2.6], [-1.5, 1.6, 4.5, 2.4], [3.8, 0.8, -5.2, 2.8], [0, 2.2, -1.5, 2.0]];

for (const [x, y, z, w] of platformSpecs) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.32, w * 0.85),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.48, metalness: 0.28, emissive: 0x0b1220, emissiveIntensity: 0.2 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  platforms.push({ mesh, y: y + 0.16 + 0.9, half: w * 0.45 });
}

const hazards = new THREE.Group();
if (GENRE === 'defense' || GENRE === 'race') {
  const count = GENRE === 'defense' ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.38 + Math.random() * 0.2, 0),
      new THREE.MeshStandardMaterial({ color: 0xfb7185, emissive: 0x9f1239, emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.4 })
    );
    const a = (i / count) * Math.PI * 2;
    orb.position.set(Math.cos(a) * (5 + (i % 3)), 1.1 + (i % 2) * 0.4, Math.sin(a) * (GENRE === 'race' ? -8 - i : 5 + (i % 3)));
    orb.userData = { phase: Math.random() * Math.PI * 2, speed: 0.7 + Math.random() * 0.8, radius: 4.5 + (i % 3) };
    orb.castShadow = true;
    hazards.add(orb);
  }
  scene.add(hazards);
}

const crystals = new THREE.Group();
const crystalCount = GENRE === 'maze' ? 20 : GENRE === 'platformer' ? 14 : GENRE === 'flyer' ? 18 : GENRE === 'defense' ? 12 : 16;
for (let i = 0; i < crystalCount; i++) {
  const geo = GENRE === 'flyer'
    ? new THREE.TorusGeometry(0.55, 0.08, 10, 28)
    : new THREE.OctahedronGeometry(0.32 + Math.random() * 0.28, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(GENRE === 'flyer' ? 0.12 + Math.random() * 0.08 : 0.48 + Math.random() * 0.18, 0.8, 0.58),
      emissive: GENRE === 'flyer' ? 0x92400e : 0x134e4a,
      emissiveIntensity: 0.7,
      roughness: 0.18,
      metalness: 0.55,
    })
  );
  const a = (i / crystalCount) * Math.PI * 2;
  const r = GENRE === 'race' ? 2.2 + (i % 3) : GENRE === 'flyer' ? 3 + (i % 5) * 1.4 : 3.4 + (i % 4) * 1.15;
  const baseY = GENRE === 'flyer'
    ? 3.5 + (i % 6) * 1.1
    : GENRE === 'platformer' && platforms[i % platforms.length]
      ? platforms[i % platforms.length].y + 0.35
      : 0.7 + (i % 5) * 0.15;
  mesh.position.set(
    Math.cos(a) * r,
    baseY,
    Math.sin(a) * (GENRE === 'race' ? -6 - i * 0.85 : GENRE === 'flyer' ? -2 - i * 0.55 : r * 0.85),
  );
  if (GENRE === 'flyer') mesh.rotation.x = Math.PI / 2;
  mesh.userData = { collected: false, baseY: mesh.position.y, value: 10 + (i % 3) * 5 };
  mesh.castShadow = true;
  crystals.add(mesh);
}
scene.add(crystals);

const dust = new THREE.Points(
  (() => {
    const g = new THREE.BufferGeometry();
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = Math.random() * 8 + 0.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 28;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  })(),
  new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.06, transparent: true, opacity: 0.45, depthAttenuation: true })
);
scene.add(dust);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.7, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const materials = [];
scene.traverse((obj) => {
  if (obj.isMesh && obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) materials.push(mat);
  }
});

const TOD = {
  dawn: { top: 0xffb07a, bottom: 0x1a2030, sun: [12, 6, 4], sunColor: 0xffc9a0, hemi: 0.55, exposure: 1.0 },
  noon: { top: 0x6eb6ff, bottom: 0x1b2a40, sun: [6, 18, 4], sunColor: 0xfff5e0, hemi: 0.9, exposure: 1.15 },
  dusk: { top: 0x163055, bottom: 0x070b14, sun: [9, 12, 7], sunColor: 0xffe0b5, hemi: 0.7, exposure: 1.08 },
  night: { top: 0x0a1428, bottom: 0x03050a, sun: [4, 8, -6], sunColor: 0xa8c4ff, hemi: 0.28, exposure: 0.82 },
};

function applyTimeOfDay(name) {
  const tod = TOD[name] || TOD.dusk;
  sky.material.uniforms.topColor.value.setHex(tod.top);
  sky.material.uniforms.bottomColor.value.setHex(tod.bottom);
  scene.fog.color.setHex(tod.bottom);
  scene.background.setHex(tod.bottom);
  sun.position.set(tod.sun[0], tod.sun[1], tod.sun[2]);
  sun.color.setHex(tod.sunColor);
  hemi.intensity = tod.hemi;
  renderer.toneMappingExposure = tod.exposure;
  stars.visible = name === 'night' || name === 'dusk';
}

function applyStudioControls(next) {
  const quality = next?.quality || 'high';
  const pr = quality === 'performance' ? 1 : quality === 'balanced' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = quality !== 'performance';
  sun.castShadow = quality !== 'performance';
  bloom.strength = quality === 'performance' ? 0.25 : quality === 'balanced' ? 0.4 : 0.55;
  grid.visible = next?.showGrid !== false;
  axes.visible = Boolean(next?.showAxes);
  const wire = Boolean(next?.wireframe);
  for (const mat of materials) if ('wireframe' in mat) mat.wireframe = wire;
  state.postFx = next?.postFx !== false;
  state.paused = Boolean(next?.paused);
  state.cameraMode = next?.cameraMode || 'follow';
  controls.enabled = state.cameraMode === 'orbit';
  applyTimeOfDay(next?.timeOfDay || 'dusk');
  if (tipsEl) {
    tipsEl.textContent = GENRE === 'flyer'
      ? 'WASD fly · Space up · Shift down · Collect rings'
      : GENRE === 'defense'
        ? 'WASD dodge · Space jump · Avoid red orbs · Collect crystals'
        : state.cameraMode === 'orbit'
          ? 'Orbit camera · WASD move · Space jump · Collect crystals'
          : state.cameraMode === 'chase'
            ? 'Chase cam · WASD move · Space jump · Collect crystals'
            : 'Follow cam · WASD move · Space jump · Collect crystals';
  }
}

const state = { postFx: true, paused: false, cameraMode: 'follow', score: 0, collected: 0 };
applyStudioControls(cfg());
if (typeof window.__ARRAB_REGISTER_GAME__ === 'function') {
  window.__ARRAB_REGISTER_GAME__({ renderer, scene, camera, composer, apply: applyStudioControls });
}
addEventListener('arrab-game-control', (event) => applyStudioControls(event.detail || cfg()));

const keys = Object.create(null);
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });

let vy = 0;
let grounded = true;
const vel = new THREE.Vector3();
const clock = new THREE.Clock();
let frames = 0;
let lastFps = performance.now();
let triangles = 0;
scene.traverse((obj) => {
  if (obj.isMesh && obj.geometry) {
    const g = obj.geometry;
    const idx = g.index ? g.index.count : (g.attributes.position?.count || 0);
    triangles += Math.floor(idx / 3);
  }
});

function standHeight(x, z) {
  let y = 1.08;
  for (const p of platforms) {
    if (Math.abs(x - p.mesh.position.x) <= p.half && Math.abs(z - p.mesh.position.z) <= p.half * 0.9) {
      y = Math.max(y, p.y);
    }
  }
  return y;
}

function movePlayer(dt) {
  const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const side = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  vel.set(side, 0, -forward);
  const speed = GENRE === 'race' ? 7.8 : GENRE === 'flyer' ? 6.4 : GENRE === 'defense' ? 5.6 : 5.1;
  if (vel.lengthSq() > 0) {
    vel.normalize().multiplyScalar(speed * dt);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
    const world = new THREE.Vector3().addScaledVector(camDir, -vel.z).addScaledVector(right, vel.x);
    player.position.add(world);
    player.rotation.y = Math.atan2(world.x, world.z);
  }
  if (GENRE === 'flyer') {
    const up = (keys.Space ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight ? 1 : 0);
    player.position.y += up * 5.2 * dt;
    player.position.y = THREE.MathUtils.clamp(player.position.y, 1.2, 14);
    grounded = false;
    vy = 0;
  } else {
    if (keys.Space && grounded) {
      vy = GENRE === 'platformer' ? 7.6 : 6.4;
      grounded = false;
    }
    vy -= 19 * dt;
    player.position.y += vy * dt;
    const floor = standHeight(player.position.x, player.position.z);
    if (player.position.y <= floor) {
      player.position.y = floor;
      vy = 0;
      grounded = true;
    }
  }
  const limit = GENRE === 'flyer' ? 18 : 14;
  player.position.x = THREE.MathUtils.clamp(player.position.x, -limit, limit);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -limit, limit);

  for (const child of crystals.children) {
    if (child.userData.collected) continue;
    if (child.position.distanceTo(player.position) < (GENRE === 'flyer' ? 1.35 : 1.15)) {
      child.userData.collected = true;
      child.visible = false;
      state.score += child.userData.value;
      state.collected += 1;
      if (scoreEl) scoreEl.textContent = String(state.score);
      rim.intensity = 2.4;
    }
  }

  for (const orb of hazards.children) {
    orb.userData.phase += dt * orb.userData.speed;
    if (GENRE === 'defense') {
      orb.position.x = Math.cos(orb.userData.phase) * orb.userData.radius;
      orb.position.z = Math.sin(orb.userData.phase * 1.15) * orb.userData.radius;
      orb.position.y = 1.0 + Math.sin(orb.userData.phase * 2) * 0.35;
    } else {
      orb.position.z += Math.sin(orb.userData.phase) * 0.02;
    }
    orb.rotation.y += dt * 1.8;
    if (orb.position.distanceTo(player.position) < 1.05) {
      state.score = Math.max(0, state.score - 5);
      if (scoreEl) scoreEl.textContent = String(state.score);
      player.position.x *= 0.92;
      player.position.z *= 0.92;
      if (GENRE !== 'flyer') player.position.y = Math.max(player.position.y, standHeight(player.position.x, player.position.z));
    }
  }
}

function updateCamera(dt) {
  const focus = new THREE.Vector3(player.position.x, player.position.y + 0.35, player.position.z);
  if (state.cameraMode === 'follow') {
    const behind = new THREE.Vector3(0, 3.4, 6.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);
    const desired = focus.clone().add(behind);
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    controls.target.lerp(focus, 0.12);
  } else if (state.cameraMode === 'chase') {
    const behind = new THREE.Vector3(0, 2.2, 4.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);
    camera.position.lerp(focus.clone().add(behind), 1 - Math.pow(0.0004, dt));
    controls.target.lerp(focus, 0.2);
  } else {
    controls.target.lerp(new THREE.Vector3(player.position.x, 1.2, player.position.z), 0.08);
  }
  controls.update();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.paused) {
    movePlayer(dt);
    rim.intensity = THREE.MathUtils.lerp(rim.intensity, 1.15, dt * 2);
    crystals.rotation.y += dt * 0.18;
    for (const child of crystals.children) {
      if (child.userData.collected) continue;
      child.rotation.y += dt * 1.1;
      child.position.y = child.userData.baseY + Math.sin(performance.now() * 0.003 + child.id) * 0.18;
    }
    dust.rotation.y += dt * 0.03;
    ring.rotation.z += dt * 0.08;
    updateCamera(dt);
  } else {
    controls.update();
  }
  if (state.postFx && cfg().quality !== 'performance') composer.render();
  else renderer.render(scene, camera);

  frames += 1;
  const now = performance.now();
  if (now - lastFps >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastFps));
    frames = 0;
    lastFps = now;
    if (fpsEl) fpsEl.textContent = fps + ' FPS · ${safeTitle}';
    parent.postMessage({
      type: 'arrab-game-stats',
      fps,
      objects: scene.children.length,
      triangles,
      score: state.score,
      collected: state.collected,
      total: crystalCount,
    }, '*');
  }
  requestAnimationFrame(frame);
}
frame();
`;
}

/** Empty-state showcase scene baked into the advanced 3D stage. */
export function emptyGameDemoHtml(ar: boolean): string {
  const title = ar ? "ساحة عراب المتقدمة" : "Arrab Advanced Arena";
  return buildGamePreviewHtml(localGameFromPrompt(title), {
    emptyDemo: true,
    quality: "high",
    showGrid: true,
    postFx: true,
    cameraMode: "follow",
    timeOfDay: "dusk",
  });
}

/**
 * Inline CSS/JS like the web preview, then harden for Three.js games.
 */
export function enhanceGamePreviewHtml(html: string, options: GamePreviewOptions = {}): string {
  let next = html;
  const quality = options.quality ?? "high";
  const pixelRatio =
    quality === "performance" ? "1" : quality === "balanced" ? "Math.min(devicePixelRatio, 1.5)" : "Math.min(devicePixelRatio, 2)";

  if (!/importmap/i.test(next)) {
    const importMap = `<script type="importmap">
{"imports":{"three":"${THREE_CDN}/build/three.module.js","three/addons/":"${THREE_CDN}/examples/jsm/"}}
</script>`;
    if (/<\/head>/i.test(next)) next = next.replace(/<\/head>/i, `${importMap}\n</head>`);
    else next = `${importMap}${next}`;
  }

  const bridge = `<script>
window.__ARRAB_GAME__ = {
  quality: ${JSON.stringify(quality)},
  showGrid: ${options.showGrid !== false},
  showAxes: ${Boolean(options.showAxes)},
  wireframe: ${Boolean(options.wireframe)},
  postFx: ${options.postFx !== false},
  paused: ${Boolean(options.paused)},
  cameraMode: ${JSON.stringify(options.cameraMode ?? "follow")},
  timeOfDay: ${JSON.stringify(options.timeOfDay ?? "dusk")},
  pixelRatioExpr: ${JSON.stringify(pixelRatio)}
};
window.__ARRAB_REGISTER_GAME__ = function (runtime) {
  window.__ARRAB_GAME_RUNTIME__ = runtime;
  if (runtime && typeof runtime.apply === 'function') runtime.apply(window.__ARRAB_GAME__);
};
addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'arrab-game-control') return;
  window.__ARRAB_GAME__ = { ...window.__ARRAB_GAME__, ...data.payload };
  const runtime = window.__ARRAB_GAME_RUNTIME__;
  if (runtime && typeof runtime.apply === 'function') runtime.apply(window.__ARRAB_GAME__);
  dispatchEvent(new CustomEvent('arrab-game-control', { detail: window.__ARRAB_GAME__ }));
});
</script>`;
  if (/<\/body>/i.test(next)) next = next.replace(/<\/body>/i, `${bridge}\n</body>`);
  else next = `${next}${bridge}`;

  return next;
}

export function buildGamePreviewHtml(
  files: StudioFile[],
  options: GamePreviewOptions = {},
): string {
  const withAlias: StudioFile[] = [...files];
  const game = withAlias.find((file) => file.path === "game.js");
  if (game && !withAlias.some((file) => file.path === "app.js")) {
    withAlias.push({ path: "app.js", content: game.content });
  }
  let html = buildPreviewHtml(withAlias);
  if (game && /<script[^>]+src=["']game\.js["'][^>]*type=["']module["'][^>]*>\s*<\/script>/i.test(html)) {
    html = html.replace(
      /<script[^>]+src=["']game\.js["'][^>]*type=["']module["'][^>]*>\s*<\/script>/i,
      `<script type="module">\n${game.content}\n</script>`,
    );
  } else if (game && /<script[^>]+type=["']module["'][^>]+src=["']game\.js["'][^>]*>\s*<\/script>/i.test(html)) {
    html = html.replace(
      /<script[^>]+type=["']module["'][^>]+src=["']game\.js["'][^>]*>\s*<\/script>/i,
      `<script type="module">\n${game.content}\n</script>`,
    );
  } else if (game && /<script[^>]+src=["']game\.js["'][^>]*>\s*<\/script>/i.test(html)) {
    html = html.replace(
      /<script[^>]+src=["']game\.js["'][^>]*>\s*<\/script>/i,
      `<script type="module">\n${game.content}\n</script>`,
    );
  }
  return enhanceGamePreviewHtml(html, options);
}
