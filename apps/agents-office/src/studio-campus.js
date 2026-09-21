// Arrab Studio campus — user-created department offices from above.
// Click office → dept panel (people / activity / chat). Click agent → status + chat.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AGENTS, DEPTS } from './data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function readOverlay() {
  const o = (typeof window !== 'undefined' && window.__ARRAB_OVERLAY__) || { depts: {}, agents: [], connectors: [] };
  return {
    depts: o.depts && typeof o.depts === 'object' ? o.depts : {},
    agents: Array.isArray(o.agents) ? o.agents : [],
    connectors: Array.isArray(o.connectors) ? o.connectors : [],
  };
}

function openArrabConnectors() {
  try {
    window.parent?.postMessage({ type: 'arrab:open-connectors' }, '*');
  } catch {
    /* not embedded */
  }
}

function connectorsBlock(connectors) {
  const rows = (connectors || []).slice(0, 8);
  return `
    <div class="meta" style="margin-top:4px">
      <div class="m" style="grid-column:1/-1">
        <div class="k">Connectors</div>
        <div class="v" style="font-size:12px;font-weight:500;margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">
          ${rows.length
            ? rows.map((c) =>
                `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:999px;padding:4px 8px;font-size:10px;letter-spacing:.04em">${esc(c.name || c.provider || 'Connector')}</span>`
              ).join('')
            : '<span style="color:var(--muted)">None linked yet</span>'}
        </div>
        <button type="button" data-act="add-connector" style="margin-top:10px;width:100%;border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:999px;padding:9px 12px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">
          Add connector
        </button>
      </div>
    </div>`;
}

function askArrabOfficeChat({ arrabId, teamId, text, history }) {
  return new Promise((resolve, reject) => {
    if ((!arrabId && !teamId) || !window.parent || window.parent === window) {
      reject(new Error('no-arrab'));
      return;
    }
    const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const onMsg = (event) => {
      if (event?.data?.type !== 'arrab:office-chat-reply' || event.data.id !== id) return;
      window.removeEventListener('message', onMsg);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.reply || '…');
    };
    window.addEventListener('message', onMsg);
    try {
      window.parent.postMessage(
        {
          type: 'arrab:office-chat',
          id,
          agentId: arrabId || null,
          teamId: teamId || null,
          text,
          history: (history || []).slice(-8),
        },
        '*',
      );
    } catch (err) {
      window.removeEventListener('message', onMsg);
      reject(err);
      return;
    }
    setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error('timeout'));
    }, 90_000);
  });
}

function agentDept(agentId, fallback) {
  return AGENTS.find((x) => x.id === agentId)?.dept || fallback || null;
}

const DEPT_CAPACITY = 8;

function rosterForRoom(key, overlay) {
  if (key === 'brain') return [];
  if (key === 'files') {
    const sec = AGENTS.find((x) => x.id === 'sec');
    const fromOv = overlay.agents.find((a) => a.id === 'sec');
    return [{
      id: 'sec',
      name: String(fromOv?.name || sec?.name || 'SECRETARY').toUpperCase(),
      role: String(fromOv?.role || 'File database · uploads'),
      seat: 0,
      dept: 'files',
      arrabId: fromOv?.arrabId || null,
    }];
  }
  const rows = overlay.agents.filter((a) => (a.dept || agentDept(a.id)) === key);
  return rows.slice(0, DEPT_CAPACITY).map((a, i) => ({
    id: a.id,
    name: String(a.name || AGENTS.find((x) => x.id === a.id)?.name || 'Agent').toUpperCase(),
    role: String(a.role || DEPTS[key]?.name || ''),
    seat: i,
    dept: key,
    arrabId: a.arrabId || null,
  }));
}

/** Brain always center; FILES always present; user Workforce teams around them. */
function roomsFromOverlay(overlay) {
  const userKeys = Object.keys(overlay.depts || {}).filter((k) => k && k !== 'lobby' && k !== 'brain' && k !== 'files');
  const brain = { key: 'brain', name: 'THE BRAIN', x: 0, z: 0, w: 12, d: 12, seats: 0, windows: 'both', kind: 'brain' };
  const files = { key: 'files', name: 'FILES', x: 0, z: 24, w: 12, d: 10, seats: 2, windows: 's', kind: 'files' };
  const defs = [brain, files];
  const n = userKeys.length;
  const rad = n <= 1 ? 22 : n <= 4 ? 26 : 30;
  userKeys.forEach((key, i) => {
    const ang = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    // keep clear of FILES at +z
    let x = Math.cos(ang) * rad;
    let z = Math.sin(ang) * rad;
    if (Math.abs(x) < 6 && z > 10) { x = (i % 2 ? 1 : -1) * rad; z = 8; }
    defs.push({
      key,
      name: String(overlay.depts[key]?.name || DEPTS[key]?.name || key).toUpperCase(),
      x, z,
      // every department office always has 8 desks
      w: 16, d: 13, seats: DEPT_CAPACITY,
      windows: z > 0.15 ? 's' : 'n',
      kind: 'office',
    });
  });
  return defs;
}

function woodTex(tone = 165) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = `rgb(${tone - 20},${tone - 40},${tone - 70})`;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    x.strokeStyle = `rgba(60,35,15,${0.04 + Math.random() * 0.08})`;
    x.beginPath();
    const y = Math.random() * 256;
    x.moveTo(0, y);
    x.bezierCurveTo(80, y + (Math.random() - 0.5) * 18, 180, y + (Math.random() - 0.5) * 18, 256, y);
    x.stroke();
  }
  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  return tx;
}

function sh(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeDesk(face = 1) {
  const g = new THREE.Group();
  const topM = new THREE.MeshStandardMaterial({ map: woodTex(165), roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.4, metalness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.3 });
  const t = sh(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.7), topM));
  t.position.y = 1.05; g.add(t);
  [-0.62, 0.62].forEach((dx) => {
    const l = sh(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.03, 0.5), metal));
    l.position.set(dx, 0.52, 0); g.add(l);
  });
  const st = sh(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), metal));
  st.position.set(0, 1.22, -0.2 * face); g.add(st);
  const mon = sh(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.37, 0.03), metal));
  mon.position.set(0, 1.45, -0.2 * face); g.add(mon);
  const sm = new THREE.MeshStandardMaterial({ color: 0x151a1f, emissive: 0xcfe0ee, emissiveIntensity: 0.05 });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.33), sm);
  scr.position.set(0, 1.45, -0.2 * face + 0.017 * face);
  if (face < 0) scr.rotation.y = Math.PI;
  g.add(scr);
  const mug = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 16), white));
  mug.position.set(0.5, 1.12, 0.1 * face); g.add(mug);
  const pad = sh(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.01, 0.28), white));
  pad.position.set(-0.4, 1.075, 0.05 * face); pad.rotation.y = 0.3; g.add(pad);
  g.userData.screenMat = sm;
  return g;
}

function makePlant(s = 1) {
  const g = new THREE.Group();
  const pot = sh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.17, 0.45, 18),
    new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.9 }),
  ));
  pot.position.y = 0.22; g.add(pot);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4d6e43, roughness: 0.6 });
  for (let i = 0; i < 18; i++) {
    const l = sh(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), leaf));
    l.scale.set(0.35, 1.6, 0.08);
    const a = i * 2.4; const r = 0.08 + (i % 5) * 0.03;
    l.position.set(Math.cos(a) * r, 0.75 + (i % 4) * 0.12, Math.sin(a) * r);
    l.rotation.set(Math.cos(a) * 0.6, a, Math.sin(a) * 0.6);
    g.add(l);
  }
  g.scale.setScalar(s);
  return g;
}

function makeBrainCore() {
  const g = new THREE.Group();
  // soft glowing orb — readable as “the brain” from above
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 28, 22),
    new THREE.MeshStandardMaterial({
      color: 0xc9d4e8, emissive: 0x6b8cbb, emissiveIntensity: 0.55,
      roughness: 0.35, metalness: 0.15, transparent: true, opacity: 0.92,
    }),
  );
  core.position.y = 1.7; core.castShadow = true; g.add(core);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, 0.06, 10, 48),
    new THREE.MeshStandardMaterial({ color: 0x8fa3c8, emissive: 0x8fa3c8, emissiveIntensity: 0.4, roughness: 0.4 }),
  );
  halo.rotation.x = Math.PI / 2; halo.position.y = 1.7; g.add(halo);
  const ring2 = halo.clone(); ring2.scale.setScalar(1.22); ring2.rotation.z = 0.4; g.add(ring2);
  // pedestals
  const base = sh(new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.6, 0.18, 32),
    new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.9 }),
  ));
  base.position.y = 0.1; g.add(base);
  // orbiting “thought” dots
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const d = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0x7ddea8 : 0xe69393,
        emissive: i % 2 ? 0x7ddea8 : 0xe69393,
        emissiveIntensity: 1.4,
      }),
    );
    d.position.set(Math.cos(a) * 2.6, 1.7 + Math.sin(i) * 0.35, Math.sin(a) * 2.6);
    g.add(d);
  }
  g.userData.brainSpin = true;
  return g;
}

function makeRoom(def) {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.userData.room = def.key;

  const floorTex = woodTex(def.kind === 'brain' ? 175 : 150);
  floorTex.repeat.set(def.w / 3, def.d / 3);
  const floorCol = def.kind === 'brain'
    ? new THREE.MeshStandardMaterial({ color: 0xe2e6f0, roughness: 0.78 })
    : def.kind === 'files'
      ? new THREE.MeshStandardMaterial({ color: 0xe2e6ec, map: floorTex, roughness: 0.72 })
      : new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72 });
  const floor = sh(new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d), floorCol));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  g.add(floor);

  if (def.kind !== 'brain') {
    const rug = sh(new THREE.Mesh(
      new THREE.PlaneGeometry(def.w * 0.62, def.d * 0.52),
      new THREE.MeshStandardMaterial({ color: def.kind === 'files' ? 0xc5ccd6 : 0xb9b2a2, roughness: 1 }),
    ));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.02;
    g.add(rug);
  }

  const wallM = new THREE.MeshStandardMaterial({
    color: def.kind === 'brain' ? 0xe8ecf4 : 0xeeebe4,
    roughness: 0.95,
  });
  const hw = def.w / 2; const hd = def.d / 2; const wallH = def.kind === 'brain' ? 2.8 : 3.6;
  const walls = [
    { p: [0, wallH / 2, -hd], s: [def.w, wallH, 0.18] },
    { p: [0, wallH / 2, hd], s: [def.w, wallH, 0.18], door: true },
    { p: [-hw, wallH / 2, 0], s: [0.18, wallH, def.d] },
    { p: [hw, wallH / 2, 0], s: [0.18, wallH, def.d] },
  ];
  for (const w of walls) {
    if (w.door) {
      const gap = def.kind === 'brain' ? 3.2 : 2.4;
      const side = (def.w - gap) / 2;
      [-1, 1].forEach((sign) => {
        const panel = sh(new THREE.Mesh(new THREE.BoxGeometry(side, wallH, 0.18), wallM));
        panel.position.set(sign * (gap / 2 + side / 2), wallH / 2, hd);
        g.add(panel);
      });
      const lintel = sh(new THREE.Mesh(new THREE.BoxGeometry(gap, 0.55, 0.18), wallM));
      lintel.position.set(0, wallH - 0.28, hd);
      g.add(lintel);
      continue;
    }
    const mesh = sh(new THREE.Mesh(new THREE.BoxGeometry(...w.s), wallM));
    mesh.position.set(...w.p);
    g.add(mesh);
  }

  if (def.kind === 'brain') {
    const brain = makeBrainCore();
    brain.traverse((o) => {
      if (o.isMesh) {
        o.userData.room = def.key;
        o.userData.brainHit = true;
      }
    });
    g.add(brain);
    g.userData.seats = [];
    g.userData.screens = [];
    g.userData.center = new THREE.Vector3(def.x, 0, def.z);
    g.userData.labelY = 8.4;
    g.userData.brainCore = brain;
    return g;
  }

  const glass = new THREE.MeshStandardMaterial({
    color: 0xb8c2b6,
    roughness: 0.55,
    metalness: 0.08,
    // solid panes — transparent glass shimmers / glitters when far away
  });
  const frameM = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.7 });
  const winWall = def.windows === 'n' || def.windows === 'both' ? -1 : 1;
  const wz = winWall * (hd - 0.08);
  // fewer, wider windows so thin vertical slits don't alias at distance
  const count = Math.max(2, Math.min(4, Math.floor(def.w / 4.2)));
  for (let i = 0; i < count; i++) {
    const x = -hw + 2.0 + i * ((def.w - 4.0) / Math.max(1, count - 1));
    const pane = sh(new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.85, 0.12), glass));
    pane.position.set(x, 1.95, wz);
    pane.receiveShadow = true;
    g.add(pane);
    const f = sh(new THREE.Mesh(new THREE.BoxGeometry(1.48, 1.98, 0.06), frameM));
    f.position.set(x, 1.95, wz + winWall * 0.08);
    g.add(f);
  }

  const seats = [];
  const screens = [];
  const nSeats = def.seats;
  if (nSeats > 0) {
    // 8-desk offices use a clean 4×2 grid; smaller rooms keep compact packing
    const cols = nSeats >= 8 ? 4 : Math.min(3, Math.ceil(nSeats / 2));
    const rows = Math.ceil(nSeats / cols);
    const gapX = nSeats >= 8 ? 2.05 : 2.2;
    const gapZ = nSeats >= 8 ? 2.55 : 2.35;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (i >= nSeats) break;
        const face = r % 2 === 0 ? 1 : -1;
        const x = (c - (cols - 1) / 2) * gapX;
        const z = (r - (rows - 1) / 2) * gapZ;
        const desk = makeDesk(face);
        desk.position.set(x, 0, z);
        g.add(desk);
        screens.push(desk.userData.screenMat);
        seats.push({
          x, z: z + 0.55 * face, face,
          world: new THREE.Vector3(def.x + x, 0, def.z + z + 0.55 * face),
        });
        i++;
      }
    }
  }

  // simple filing cabinets for FILES office
  if (def.kind === 'files') {
    const cabM = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.75, metalness: 0.12 });
    for (let i = 0; i < 3; i++) {
      const cab = sh(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.7), cabM));
      cab.position.set(-hw + 1.4 + i * 1.35, 0.9, -hd + 1.1);
      g.add(cab);
    }
  }

  const p1 = makePlant(1.05); p1.position.set(-hw + 1.1, 0, -hd + 1.1); g.add(p1);
  const p2 = makePlant(0.9); p2.position.set(hw - 1.1, 0, hd - 1.4); g.add(p2);

  g.userData.seats = seats;
  g.userData.screens = screens;
  g.userData.center = new THREE.Vector3(def.x, 0, def.z);
  g.userData.labelY = 6.8;
  return g;
}

function retarget(sG, mG) {
  const idle = sG.animations.find((a) => a.name === 'Idle');
  const tpS = sG.animations.find((a) => a.name === 'TPose');
  const tpM = mG.animations.find((a) => a.name === 'TPose');
  if (!idle || !tpS || !tpM) return idle || mG.animations[0] || null;
  const S = cloneSkeleton(sG.scene);
  const M = cloneSkeleton(mG.scene);
  const bonesOf = (o) => {
    const m = {}; const list = [];
    o.traverse((x) => { if (x.isBone) { m[x.name] = x; list.push(x); } });
    return { m, list };
  };
  const bs = bonesOf(S); const bm = bonesOf(M);
  if (!bm.list.length || !bs.list.length) return idle;
  const pose = (root, clip) => {
    const mx = new THREE.AnimationMixer(root);
    const ac = mx.clipAction(clip); ac.play(); mx.setTime(0); root.updateMatrixWorld(true); return mx;
  };
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  pose(S, tpS);
  const restS = {}; bs.list.forEach((x) => { restS[x.name] = wq(x); });
  pose(M, tpM);
  const restM = {}; const parentStatic = {};
  bm.list.forEach((x) => {
    restM[x.name] = wq(x);
    if (!x.parent?.isBone) parentStatic[x.name] = wq(x.parent);
  });
  const hipsName = bm.list[0].name;
  const hipPosM = bm.m[hipsName].position.clone();
  const HS = restS[hipsName]; const HM = restM[hipsName];
  if (!HS || !HM) return idle;
  const mxS = new THREE.AnimationMixer(S);
  mxS.clipAction(idle).play();
  const fps = 18; const n = Math.max(2, Math.round(idle.duration * fps));
  const times = new Float32Array(n);
  const vals = {}; bm.list.forEach((x) => { vals[x.name] = new Float32Array(n * 4); });
  const HSi = HS.clone().invert(); const HMi = HM.clone().invert();
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * idle.duration; times[i] = t;
    mxS.setTime(t); S.updateMatrixWorld(true);
    const worldM = {};
    bm.list.forEach((x) => {
      let qw;
      const sb = bs.m[x.name];
      if (sb && restS[x.name]) {
        const d = wq(sb).multiply(restS[x.name].clone().invert());
        const dh = HSi.clone().multiply(d).multiply(HS);
        qw = HM.clone().multiply(dh).multiply(HMi).multiply(restM[x.name]);
      } else qw = restM[x.name].clone();
      worldM[x.name] = qw;
      const pw = x.parent?.isBone ? worldM[x.parent.name] : parentStatic[x.name];
      const loc = pw.clone().invert().multiply(qw);
      loc.toArray(vals[x.name], i * 4);
    });
  }
  const tracks = bm.list.map((x) => new THREE.QuaternionKeyframeTrack(`${x.name}.quaternion`, times, vals[x.name]));
  tracks.push(new THREE.VectorKeyframeTrack(`${hipsName}.position`, [0], hipPosM.toArray()));
  return new THREE.AnimationClip('idle', idle.duration, tracks);
}

/* ---------- boot ---------- */
(async function boot() {
  const canvas = $('scene'); const veil = $('veil'); const tagLayer = $('tags');
  const liveDot = $('liveDot'); const liveText = $('liveText');
  const dock = $('dock'); const dkBody = $('dkBody'); const dkTabs = $('dkTabs');
  const dkTitle = $('dkTitle'); const dkKind = $('dkKind');
  const emptyCampus = $('emptyCampus');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // match Arrab light chrome so the iframe doesn't look like a separate beige card
  const bgc = new THREE.Color(0xe8e8e8);
  scene.background = bgc;
  scene.fog = new THREE.Fog(bgc, 55, 110);

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 220);
  camera.position.set(0, 40, 30);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.minDistance = 4;
  controls.maxDistance = 75;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.zoomSpeed = 1.15;
  controls.panSpeed = 0.9;
  controls.enablePan = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };

  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7d7060, 0.72));
  const sun = new THREE.DirectionalLight(0xffe4bd, 2.05);
  sun.position.set(-10, 22, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 90 });
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));

  // no ground slab — rooms sit on the scene background (no beige block behind the map)

  const campusRoot = new THREE.Group();
  scene.add(campusRoot);
  const corridorRoot = new THREE.Group();
  scene.add(corridorRoot);

  let rooms = [];
  let roomByKey = {};
  const roomGroups = new Map();
  const roomTags = new Map();
  const corridorHits = [];
  let focusedRoom = null;
  let selected = null;
  let dockMode = null; // 'dept' | 'agent'
  let dockTab = 'people';
  let taskCache = [];
  const chatHist = {};
  let lastRoomSig = '';

  const loader = new GLTFLoader();
  const loadGlb = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  let personSrc = null; let idleClip = null;
  const people = new Map();
  const mixers = [];
  const clock = new THREE.Clock();
  let camTween = null;

  try {
    const [personGltf, keeperGltf] = await Promise.all([
      loadGlb('/assets/studio/modelPerson.glb'),
      loadGlb('/assets/studio/modelKeeper.glb'),
    ]);
    idleClip = retarget(keeperGltf, personGltf);
    personSrc = personGltf.scene;
    veil.classList.add('gone');
  } catch (err) {
    console.warn(err);
    veil.textContent = "Characters couldn't load — rooms still work.";
    setTimeout(() => veil.classList.add('gone'), 800);
  }

  function clearCampus() {
    while (campusRoot.children.length) {
      const c = campusRoot.children[0];
      campusRoot.remove(c);
    }
    while (corridorRoot.children.length) corridorRoot.remove(corridorRoot.children[0]);
    corridorHits.length = 0;
    roomGroups.clear();
    for (const t of roomTags.values()) t.remove();
    roomTags.clear();
    for (const [, p] of people) {
      scene.remove(p.m);
      mixers.splice(mixers.indexOf(p.mx), 1);
      p.tag.remove();
    }
    people.clear();
  }

  function buildCampus(overlay) {
    const next = roomsFromOverlay(overlay);
    const sig = next.map((r) => `${r.key}:${r.seats}:${r.name}`).join('|');
    if (sig === lastRoomSig && roomGroups.size) return;
    lastRoomSig = sig;
    clearCampus();
    rooms = next;
    roomByKey = Object.fromEntries(rooms.map((r) => [r.key, r]));

    emptyCampus.classList.toggle('on', false);

    const corridorM = new THREE.MeshStandardMaterial({ color: 0xc4c7bf, roughness: 0.88 });
    for (const def of rooms) {
      const group = makeRoom(def);
      campusRoot.add(group);
      roomGroups.set(def.key, group);

      const tag = document.createElement('div');
      tag.className = 'room-tag' + (def.kind === 'brain' ? ' brain' : def.kind === 'files' ? ' files' : '');
      const sub = def.kind === 'brain' ? 'Goals · ideas · features' : def.kind === 'files' ? 'Database · secretary' : '0 seated';
      tag.innerHTML = `<div class="n">${esc(def.name)}</div><div class="c">${esc(sub)}</div>`;
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        openDept(def.key);
      });
      tagLayer.appendChild(tag);
      roomTags.set(def.key, tag);

      // walkway to brain (center) — skip brain itself
      if (def.key === 'brain') continue;
      const dx = def.x; const dz = def.z;
      const len = Math.hypot(dx, dz);
      if (len > 8) {
        const plank = sh(new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 0.07, Math.max(5, len - def.d / 2 - 5)),
          corridorM,
        ));
        plank.position.set(dx * 0.48, 0.02, dz * 0.48);
        plank.rotation.y = Math.atan2(dx, dz);
        plank.userData.corridorTo = def.key;
        corridorRoot.add(plank);
        corridorHits.push(plank);

        const ct = document.createElement('div');
        ct.className = 'room-tag cross';
        ct.textContent = '→ ' + def.name.slice(0, 12);
        ct.addEventListener('click', (e) => {
          e.stopPropagation();
          openDept(def.key);
        });
        tagLayer.appendChild(ct);
        roomTags.set('cross:' + def.key, ct);
      }
    }
  }

  function makePerson(agent, seat) {
    const m = cloneSkeleton(personSrc);
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.userData.agentId = agent.id;
      }
    });
    m.position.copy(seat.world);
    m.rotation.y = (seat.face < 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.2;
    m.scale.setScalar(0.95 + Math.random() * 0.05);
    scene.add(m);
    const mx = new THREE.AnimationMixer(m);
    if (idleClip) {
      const ac = mx.clipAction(idleClip);
      ac.timeScale = 0.75 + Math.random() * 0.25;
      ac.play();
      mx.setTime(Math.random() * 2);
    }
    mixers.push(mx);
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.addEventListener('click', (e) => { e.stopPropagation(); openAgent(agent.id); });
    tagLayer.appendChild(tag);
    return { m, mx, tag, room: agent.dept, seat: agent.seat, agent };
  }

  function tasksForAgent(id) {
    return taskCache.filter((t) => t.agent === id || t.agentId === id);
  }
  function doingFor(id) {
    return tasksForAgent(id).find((t) => /doing|progress|run|active/i.test(String(t.status || '')))
      || tasksForAgent(id)[0]
      || null;
  }

  function syncPeople() {
    const overlay = readOverlay();
    buildCampus(overlay);
    const want = new Map();
    for (const room of rooms) {
      if (room.key === 'brain') {
        const tag = roomTags.get('brain');
        if (tag) {
          tag.querySelector('.n').textContent = 'THE BRAIN';
          tag.querySelector('.c').textContent = 'Goals · ideas · features';
          tag.classList.toggle('sel', focusedRoom === 'brain');
        }
        continue;
      }
      const roster = rosterForRoom(room.key, overlay);
      const group = roomGroups.get(room.key);
      const seats = group?.userData.seats || [];
      roster.forEach((agent, i) => {
        if (i >= seats.length) return;
        want.set(agent.id, { agent: { ...agent, seat: i }, seat: seats[i] });
      });
      const tag = roomTags.get(room.key);
      if (tag) {
        const label = room.key === 'files' ? 'FILES' : (overlay.depts[room.key]?.name || room.name);
        tag.querySelector('.n').textContent = String(label).toUpperCase();
        if (room.key === 'files') {
          const nFiles = window.__ARRAB_FILE_COUNT__ ?? 0;
          tag.querySelector('.c').textContent = `Secretary · ${nFiles} file${nFiles === 1 ? '' : 's'}`;
        } else {
          tag.querySelector('.c').textContent = `${roster.length} / ${DEPT_CAPACITY} seated`;
        }
        tag.classList.toggle('sel', focusedRoom === room.key);
      }
      (group?.userData.screens || []).forEach((sm, i) => {
        sm.userData.target = roster[i] ? 1.5 : 0.05;
      });
    }

    for (const [id, p] of people) {
      if (!want.has(id)) {
        scene.remove(p.m);
        mixers.splice(mixers.indexOf(p.mx), 1);
        p.tag.remove();
        people.delete(id);
      }
    }
    if (personSrc) {
      for (const [id, { agent, seat }] of want) {
        let p = people.get(id);
        if (!p) {
          p = makePerson(agent, seat);
          people.set(id, p);
        } else {
          p.agent = agent;
        }
        const short = agent.name.length > 12 ? agent.name.slice(0, 11) + '…' : agent.name;
        p.tag.innerHTML = `<span class="dot on"></span><span class="nm">${esc(short)}</span>`;
        p.tag.classList.toggle('sel', selected === id);
        p.tag.title = `${agent.name}${agent.role ? ' · ' + agent.role : ''}`;
      }
    }

    const n = want.size;
    liveDot.classList.toggle('on', n > 0);
    const offices = rooms.filter((r) => r.key !== 'brain').length;
    liveText.textContent = `${offices} office${offices === 1 ? '' : 's'} · ${n} seated`;
    if (dockMode) renderDock();
  }

  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function flyTo(target, dist = 14) {
    const toT = target.clone();
    const toP = toT.clone().add(new THREE.Vector3(0.15, dist * 0.7, dist * 0.55));
    camTween = {
      t0: performance.now(), dur: 620,
      fromP: camera.position.clone(), toP,
      fromT: controls.target.clone(), toT,
    };
  }

  function flyOverview() {
    focusedRoom = null;
    selected = null;
    dockMode = null;
    closeDock();
    flyTo(new THREE.Vector3(0, 0, 0), 42);
    for (const [k, tag] of roomTags) {
      if (!k.startsWith('cross:')) tag.classList.remove('sel');
    }
  }

  function openDept(key) {
    const room = roomByKey[key];
    if (!room) return;
    focusedRoom = key;
    selected = null;
    if (key === 'brain') {
      dockMode = 'brain';
      dockTab = 'goals';
      flyTo(new THREE.Vector3(room.x, 0.4, room.z), 11);
      void refreshBrain().then(() => { if (dockMode === 'brain') renderDock(); });
    } else if (key === 'files') {
      dockMode = 'files';
      dockTab = 'vault';
      flyTo(new THREE.Vector3(room.x, 0.2, room.z), 12);
      void refreshFilesVault().then(() => { if (dockMode === 'files') renderDock(); });
    } else {
      dockMode = 'dept';
      dockTab = 'people';
      flyTo(new THREE.Vector3(room.x, 0.2, room.z), 13);
    }
    for (const [k, tag] of roomTags) {
      if (!k.startsWith('cross:')) tag.classList.toggle('sel', k === key);
    }
    openDock();
    renderDock();
  }

  function openAgent(id) {
    const p = people.get(id);
    if (!p) return;
    selected = id;
    focusedRoom = p.room;
    dockMode = 'agent';
    dockTab = 'status';
    flyTo(p.m.position.clone(), 7.2);
    openDock();
    renderDock();
  }

  function openDock() {
    dock.classList.add('on');
    document.body.classList.add('dock-open');
  }
  function closeDock() {
    dock.classList.remove('on');
    document.body.classList.remove('dock-open');
    dockMode = null;
    selected = null;
  }

  function setTabs(items) {
    dkTabs.innerHTML = items.map(([id, label]) =>
      `<button type="button" data-tab="${id}" class="${dockTab === id ? 'on' : ''}">${label}</button>`
    ).join('');
  }

  async function refreshTasks() {
    try {
      const list = await (await fetch('/api/tasks', { cache: 'no-store' })).json();
      taskCache = Array.isArray(list) ? list : (list.tasks || []);
    } catch { /* ignore */ }
  }

  let filesState = { files: [], storage: null };
  async function refreshFilesVault() {
    try {
      const data = await (await fetch('/api/files', { cache: 'no-store' })).json();
      filesState.files = Array.isArray(data.files) ? data.files : [];
      filesState.storage = data.storage || null;
      window.__ARRAB_FILE_COUNT__ = filesState.files.length;
      const tag = roomTags.get('files');
      if (tag) {
        const n = filesState.files.length;
        tag.querySelector('.c').textContent = `Secretary · ${n} file${n === 1 ? '' : 's'}`;
      }
    } catch {
      filesState = { files: [], storage: null };
    }
  }

  async function uploadFiles(fileList) {
    for (const file of Array.from(fileList || [])) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      await fetch('/api/files', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          data: btoa(bin),
        }),
      });
    }
    await refreshFilesVault();
    renderDock();
  }

  let brainNotes = [];
  async function refreshBrain() {
    try {
      const g = await (await fetch('/api/brain', { cache: 'no-store' })).json();
      brainNotes = Array.isArray(g?.nodes) ? g.nodes.slice(0, 40) : [];
      if (!brainNotes.length && Array.isArray(g?.notes)) brainNotes = g.notes;
    } catch { brainNotes = []; }
  }

  async function captureBrain(kind, title, body) {
    const res = await fetch('/api/brain/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, title, body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    await refreshBrain();
  }

  function renderDock() {
    const overlay = readOverlay();

    if (dockMode === 'brain') {
      dkKind.textContent = 'THE BRAIN';
      dkTitle.textContent = 'Goals & knowledge';
      setTabs([['goals', 'Goals'], ['ideas', 'Ideas'], ['features', 'Features'], ['vault', 'Vault']]);
      const kind = dockTab === 'ideas' ? 'idea' : dockTab === 'features' ? 'decision' : dockTab === 'vault' ? 'vault' : 'goal';
      if (kind === 'vault') {
        dkBody.innerHTML = `
          <div class="empty" style="font-style:normal">Everything you capture lands in the Brain vault and shapes how the office works.</div>
          <div class="feed">${brainNotes.length ? brainNotes.slice(0, 16).map((n) => {
            const label = typeof n === 'string' ? n : (n.id || n.title || 'Note');
            return `<div class="ev"><div class="t">NOTE</div>${esc(label)}</div>`;
          }).join('') : '<div class="empty">Vault is quiet — capture a goal or idea.</div>'}</div>`;
        return;
      }
      const label = kind === 'goal' ? 'Goal' : kind === 'idea' ? 'Idea' : 'Feature / requirement';
      dkBody.innerHTML = `
        <div class="empty" style="font-style:normal;padding-bottom:4px">Press the Brain to capture ${label.toLowerCase()}s for the whole studio.</div>
        <form id="brainForm" class="chat" style="gap:8px">
          <input id="brainTitle" placeholder="${esc(label)} title" autocomplete="off" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:13px;background:#fff" />
          <textarea id="brainBody" rows="4" placeholder="Details, requirements, next step…" style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:13px;background:#fff;resize:vertical"></textarea>
          <button type="submit" style="border:0;background:var(--ink);color:#fff;border-radius:999px;padding:10px 16px;font:inherit;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;cursor:pointer">Save to Brain</button>
          <div id="brainErr" class="empty" style="color:#9B3B30;min-height:1.2em"></div>
        </form>`;
      $('brainForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = $('brainTitle').value.trim();
        const body = $('brainBody').value.trim();
        const err = $('brainErr');
        if (!title) { err.textContent = 'Add a title first.'; return; }
        try {
          await captureBrain(kind === 'decision' ? 'decision' : kind, title, body);
          $('brainTitle').value = '';
          $('brainBody').value = '';
          err.style.color = 'var(--muted)';
          err.textContent = 'Saved to the Brain.';
          dockTab = 'vault';
          renderDock();
        } catch (ex) {
          err.style.color = '#9B3B30';
          err.textContent = ex.message || 'Save failed';
        }
      });
      return;
    }

    if (dockMode === 'files') {
      dkKind.textContent = 'FILES OFFICE';
      dkTitle.textContent = 'Database';
      setTabs([['vault', 'Vault'], ['people', 'Secretary'], ['chat', 'Chat']]);
      const st = filesState.storage || {};
      const roster = rosterForRoom('files', overlay);
      if (dockTab === 'people') {
        dkBody.innerHTML = `
          <div class="meta">
            <div class="m"><div class="k">Role</div><div class="v">Secretary</div></div>
            <div class="m"><div class="k">Files</div><div class="v">${filesState.files.length}</div></div>
          </div>
          <div class="people-list">
            ${roster.map((a) => `<button type="button" class="row" data-agent="${esc(a.id)}">
              <span class="dot"></span>
              <span class="nm">${esc(a.name)}<div class="rl">${esc(a.role)}</div></span>
            </button>`).join('')}
          </div>`;
        return;
      }
      if (dockTab === 'chat') {
        const sec = roster[0];
        renderChatPane('sec', sec?.name || 'SECRETARY', {
          arrabId: sec?.arrabId || null,
          officeKey: 'files',
          officeLabel: 'Files',
        });
        return;
      }
      const pct = Math.max(0, Math.min(100, Number(st.pct) || 0));
      dkBody.innerHTML = `
        <div class="meta">
          <div class="m"><div class="k">Consumed</div><div class="v">${esc(st.consumedLabel || '0 B')}</div></div>
          <div class="m"><div class="k">Limit</div><div class="v">${esc(st.limitLabel || '5 GB')}</div></div>
        </div>
        <div class="m" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px">
          <div class="k">Storage</div>
          <div class="v" style="font-size:13px;margin:4px 0 8px">${esc(st.freeLabel || '—')} free · ${pct}% used</div>
          <div style="height:7px;border-radius:99px;background:rgba(23,23,31,.08);overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#8FA3C8,#5A6F94)"></i></div>
        </div>
        <div id="fvDrop" style="border:1.5px dashed var(--line);border-radius:14px;padding:16px 12px;text-align:center;font-size:12px;color:var(--muted);cursor:pointer;background:#fff">
          <b style="display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);margin-bottom:4px">Upload files</b>
          Drop here or click — stored in your office database
        </div>
        <input type="file" id="fvIn" hidden multiple>
        <div class="feed" id="fvList">
          ${filesState.files.length ? filesState.files.map((f) =>
            `<div class="ev" style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;min-width:0"><div class="t">${esc(f.sizeLabel || '')}</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</div></div>
              <button type="button" data-del="${esc(f.id)}" style="border:1px solid var(--line);background:none;border-radius:99px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;cursor:pointer;color:var(--muted)">Delete</button>
            </div>`
          ).join('') : '<div class="empty">No files yet — upload to build your database.</div>'}
        </div>`;
      const drop = $('fvDrop'); const inn = $('fvIn');
      drop?.addEventListener('click', () => inn?.click());
      inn?.addEventListener('change', () => { uploadFiles(inn.files); inn.value = ''; });
      drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--ink)'; });
      drop?.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
      drop?.addEventListener('drop', (e) => {
        e.preventDefault(); drop.style.borderColor = '';
        uploadFiles(e.dataTransfer.files);
      });
      dkBody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        await fetch('/api/files/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
        await refreshFilesVault();
        renderDock();
      }));
      return;
    }

    if (dockMode === 'dept' && focusedRoom) {
      const room = roomByKey[focusedRoom];
      const name = overlay.depts[focusedRoom]?.name || room?.name || focusedRoom;
      dkKind.textContent = 'DEPARTMENT OFFICE';
      dkTitle.textContent = String(name).toUpperCase();
      setTabs([['people', 'People'], ['activity', 'Activity'], ['chat', 'Chat']]);
      const roster = rosterForRoom(focusedRoom, overlay);
      if (dockTab === 'people') {
        dkBody.innerHTML = `
          <div class="meta">
            <div class="m"><div class="k">Seated</div><div class="v">${roster.length}</div></div>
            <div class="m"><div class="k">Desks</div><div class="v">${room?.seats || 0}</div></div>
          </div>
          ${connectorsBlock(overlay.connectors)}
          <div class="people-list" style="margin-top:10px">
            ${roster.length ? roster.map((a) => {
              const job = doingFor(a.id);
              return `<button type="button" class="row" data-agent="${esc(a.id)}">
                <span class="dot"></span>
                <span class="nm">${esc(a.name)}<div class="rl">${esc(a.role || 'Agent')}${job ? ' · ' + esc(job.title || job.text || 'working') : ' · idle'}</div></span>
              </button>`;
            }).join('') : '<div class="empty">No one seated yet — assign people to this team in Workforce.</div>'}
          </div>`;
      } else if (dockTab === 'activity') {
        const events = roster.flatMap((a) => {
          const ts = tasksForAgent(a.id).slice(0, 3);
          if (!ts.length) return [{ who: a.name, text: 'Idle at desk', t: 'LIVE' }];
          return ts.map((t) => ({ who: a.name, text: t.title || t.text || 'Task', t: String(t.status || 'live').toUpperCase() }));
        });
        const connEvents = (overlay.connectors || []).slice(0, 4).map((c) => ({
          who: c.name || c.provider || 'Connector',
          text: `Linked · ${c.status || 'connected'}`,
          t: 'CONNECTOR',
        }));
        const feed = [...connEvents, ...events];
        dkBody.innerHTML = `
          ${connectorsBlock(overlay.connectors)}
          <div class="feed" style="margin-top:10px">${feed.length ? feed.map((e) =>
            `<div class="ev"><div class="t">${esc(e.t)} · ${esc(e.who)}</div>${esc(e.text)}</div>`
          ).join('') : '<div class="empty">No live activity yet — assign a task or add a connector.</div>'}</div>`;
      } else {
        const lead = roster.find((a) => a.arrabId) || roster[0];
        const teamId = overlay.depts[focusedRoom]?.arrabId || null;
        renderChatPane(lead?.id, lead?.name || 'Office', {
          arrabId: lead?.arrabId || null,
          teamId: teamId && teamId !== 'unassigned' ? teamId : null,
          officeKey: focusedRoom,
          officeLabel: String(name),
        });
      }
    } else if (dockMode === 'agent' && selected) {
      const p = people.get(selected);
      const a = p?.agent;
      if (!a) return;
      dkKind.textContent = 'AGENT';
      dkTitle.textContent = a.name;
      setTabs([['status', 'Status'], ['activity', 'Activity'], ['chat', 'Chat']]);
      const job = doingFor(a.id);
      const roomName = overlay.depts[a.dept]?.name || roomByKey[a.dept]?.name || a.dept;
      const ovAgent = overlay.agents.find((row) => row.id === a.id);
      const arrabId = ovAgent?.arrabId || a.arrabId || null;
      if (dockTab === 'status') {
        dkBody.innerHTML = `
          <div class="meta">
            <div class="m"><div class="k">Role</div><div class="v">${esc(a.role || '—')}</div></div>
            <div class="m"><div class="k">Office</div><div class="v">${esc(String(roomName).toUpperCase())}</div></div>
          </div>
          <div class="ev" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px">
            <div class="t" style="color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">ASSIGNED / DOING</div>
            <div style="font-size:14px;font-weight:600">${job ? esc(job.title || job.text) : 'Nothing assigned right now'}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${job ? esc(String(job.status || 'in progress')) : 'Idle at desk'}</div>
          </div>
          ${connectorsBlock(overlay.connectors)}
          <button type="button" class="row" data-act="office" style="margin-top:8px"><span class="nm">Open ${esc(String(roomName))} office</span></button>
          <button type="button" class="row" data-act="chat-agent" style="margin-top:6px"><span class="nm">Open chat with ${esc(a.name)}</span></button>`;
      } else if (dockTab === 'activity') {
        const ts = tasksForAgent(a.id);
        const hist = (chatHist[a.id] || []).slice(-6).reverse();
        const chatEv = hist.map((m) => ({
          t: m.who === 'me' ? 'YOU' : 'AGENT',
          text: m.text,
        }));
        const taskEv = ts.map((t) => ({
          t: String(t.status || 'TASK').toUpperCase(),
          text: t.title || t.text || 'Work item',
        }));
        const feed = [...taskEv, ...chatEv];
        dkBody.innerHTML = `
          ${connectorsBlock(overlay.connectors)}
          <div class="feed" style="margin-top:10px">${feed.length ? feed.map((e) =>
            `<div class="ev"><div class="t">${esc(e.t)}</div>${esc(e.text)}</div>`
          ).join('') : '<div class="empty">No activity yet — send a message or assign a task.</div>'}</div>`;
      } else {
        renderChatPane(a.id, a.name, { arrabId, officeKey: null, officeLabel: null });
      }
    }
  }

  function renderChatPane(agentId, name, opts = {}) {
    if (!agentId) {
      dkBody.innerHTML = '<div class="empty">Seat someone first to chat.</div>';
      return;
    }
    const histKey = opts.officeKey ? `office:${opts.officeKey}` : agentId;
    const hist = chatHist[histKey] || [];
    const label = opts.officeLabel ? `${opts.officeLabel} office` : name;
    dkBody.innerHTML = `
      <div class="chat">
        <div class="msgs" id="dkMsgs">
          ${hist.length ? hist.map((m) =>
            `<div class="bubble ${m.who === 'me' ? 'me' : 'bot'}">${esc(m.text)}</div>`
          ).join('') : `<div class="empty">Say hello to ${esc(label)}.</div>`}
        </div>
        <form class="compose" id="dkChat">
          <input name="q" placeholder="Message ${esc(label)}…" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>`;
    const form = $('dkChat');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      chatHist[histKey] = chatHist[histKey] || [];
      chatHist[histKey].push({ who: 'me', text });
      renderDock();
      try {
        let reply = null;
        if (opts.arrabId || opts.teamId) {
          try {
            reply = await askArrabOfficeChat({
              arrabId: opts.arrabId || null,
              teamId: opts.teamId || null,
              text: opts.officeLabel ? `[Office ${opts.officeLabel}] ${text}` : text,
              history: chatHist[histKey],
            });
          } catch {
            reply = null;
          }
        }
        if (!reply) {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agent: agentId,
              text,
              history: chatHist[histKey].filter((m) => m.who === 'me' || m.who === 'bot').slice(-8),
            }),
          });
          const data = await res.json();
          reply = data.reply || data.error || '…';
        }
        chatHist[histKey].push({ who: 'bot', text: reply });
      } catch {
        chatHist[histKey].push({ who: 'bot', text: 'Chat offline right now.' });
      }
      renderDock();
      const box = $('dkMsgs');
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  dkTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    dockTab = b.dataset.tab;
    renderDock();
  });

  dkBody.addEventListener('click', (e) => {
    const agentBtn = e.target.closest('[data-agent]');
    if (agentBtn) { openAgent(agentBtn.dataset.agent); return; }
    const officeBtn = e.target.closest('[data-act="office"]');
    if (officeBtn && focusedRoom) { openDept(focusedRoom); return; }
    const chatBtn = e.target.closest('[data-act="chat-agent"]');
    if (chatBtn) { dockTab = 'chat'; renderDock(); return; }
    const addConn = e.target.closest('[data-act="add-connector"]');
    if (addConn) { openArrabConnectors(); return; }
  });

  $('dkBack').addEventListener('click', () => {
    if (dockMode === 'agent' && focusedRoom) {
      openDept(focusedRoom);
      return;
    }
    flyOverview();
  });

  function zoomBy(factor) {
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    dir.multiplyScalar(factor);
    const next = controls.target.clone().add(dir);
    const dist = next.distanceTo(controls.target);
    if (dist < controls.minDistance || dist > controls.maxDistance) return;
    camera.position.copy(next);
    controls.update();
  }
  $('zIn').onclick = () => zoomBy(0.78);
  $('zOut').onclick = () => zoomBy(1.28);
  $('zHome').onclick = flyOverview;

  // pointer pick
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);

    const personMeshes = [];
    people.forEach((p) => p.m.traverse((o) => { if (o.isMesh) personMeshes.push(o); }));
    const pHit = ray.intersectObjects(personMeshes, false)[0];
    if (pHit?.object?.userData?.agentId) {
      openAgent(pHit.object.userData.agentId);
      return;
    }

    const cHit = ray.intersectObjects(corridorHits, false)[0];
    if (cHit?.object?.userData?.corridorTo) {
      openDept(cHit.object.userData.corridorTo);
      return;
    }

    const roomMeshes = [];
    roomGroups.forEach((g) => g.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.brainHit) roomMeshes.push(o);
      else if (o.geometry?.type === 'PlaneGeometry' && Math.abs(o.rotation.x + Math.PI / 2) < 0.01) roomMeshes.push(o);
    }));
    const fHit = ray.intersectObjects(roomMeshes, false)[0];
    if (fHit) {
      let obj = fHit.object;
      while (obj && !obj.userData.room) obj = obj.parent;
      if (obj?.userData?.room) openDept(obj.userData.room);
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  await refreshTasks();
  await refreshFilesVault();
  await refreshBrain();
  syncPeople();
  setInterval(async () => {
    try {
      const res = await fetch('/api/arrab/overlay', { cache: 'no-store' });
      if (res.ok) window.__ARRAB_OVERLAY__ = await res.json();
    } catch { /* */ }
    await refreshTasks();
    await refreshFilesVault();
    syncPeople();
  }, 2500);

  const v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    mixers.forEach((m) => m.update(dt));
    roomGroups.forEach((g) => {
      (g.userData.screens || []).forEach((s) => {
        const tg = s.userData.target ?? 0.05;
        s.emissiveIntensity += (tg - s.emissiveIntensity) * 0.08;
      });
      const brain = g.userData.brainCore;
      if (brain) {
        brain.rotation.y += dt * 0.35;
        brain.children.forEach((ch, i) => {
          if (ch.geometry?.type === 'TorusGeometry') ch.rotation.z += dt * (0.2 + i * 0.08);
        });
      }
    });
    if (camTween) {
      const k = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
      const e = ease(k);
      camera.position.lerpVectors(camTween.fromP, camTween.toP, e);
      controls.target.lerpVectors(camTween.fromT, camTween.toT, e);
      if (k >= 1) camTween = null;
    }
    controls.update();
    const w = innerWidth; const h = innerHeight;
    const overviewZoom = camera.position.distanceTo(controls.target) > 28;
    people.forEach((p) => {
      v.set(p.m.position.x, 2.0, p.m.position.z).project(camera);
      const dist = camera.position.distanceTo(p.m.position);
      // hide agent nameplates when zoomed out so office titles stay readable
      const show = v.z < 1 && !overviewZoom && dist < 22 && (focusedRoom === p.room || dist < 14);
      p.tag.style.left = `${((v.x + 1) / 2) * w}px`;
      p.tag.style.top = `${((1 - v.y) / 2) * h}px`;
      p.tag.style.display = show ? 'flex' : 'none';
    });
    roomTags.forEach((tag, key) => {
      if (key.startsWith('cross:')) {
        const rk = key.slice(6);
        const room = roomByKey[rk];
        if (!room) { tag.style.display = 'none'; return; }
        const mid = new THREE.Vector3(room.x * 0.48, 0.4, room.z * 0.48);
        const dist = camera.position.distanceTo(mid);
        if (dist < 14 || focusedRoom === rk) { tag.style.display = 'none'; return; }
        v.copy(mid).project(camera);
        tag.style.left = `${((v.x + 1) / 2) * w}px`;
        tag.style.top = `${((1 - v.y) / 2) * h}px`;
        tag.style.display = v.z < 1 ? 'block' : 'none';
        return;
      }
      const room = roomByKey[key];
      if (!room) return;
      const group = roomGroups.get(key);
      const labelY = group?.userData.labelY || 7.5;
      const dist = camera.position.distanceTo(new THREE.Vector3(room.x, 0, room.z));
      if (focusedRoom === key && dist < 16) { tag.style.display = 'none'; return; }
      v.set(room.x, labelY, room.z).project(camera);
      tag.style.left = `${((v.x + 1) / 2) * w}px`;
      tag.style.top = `${((1 - v.y) / 2) * h}px`;
      tag.style.display = v.z < 1 ? 'block' : 'none';
    });
    renderer.render(scene, camera);
  });

  window.CC = { openDept, openAgent, flyOverview, syncPeople };
})();
