import SCENES_RAW from "./timeline.json";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cloneModel, loadModelLibrary, type ModelLibrary } from "./lib/modelLibrary";

const W = 1080;
const H = 1920;
const FPS = 30;

const PALETTE = {
  bg: 0x0c1017,
  panel: 0x111827,
  panelSoft: 0x182232,
  border: 0x22324a,
  cyan: 0x28d8ff,
  teal: 0x00b8a9,
  warm: 0xff8c69,
  gold: 0xffd166,
  grass: 0x5f7f36,
  grassDark: 0x405626,
  road: 0x2a2e34,
  roadMark: 0xf4f0e8,
  mapBase: 0x1c3557,
  mapGlow: 0x61b9ff,
  red: 0xff4d5a,
  orange: 0xff9f43,
  yellow: 0xffdd57,
  white: 0xffffff,
  slate: 0x93a4b8,
};

let cursor = 0;
const SCENES = SCENES_RAW.map((scene) => {
  const enriched = { ...scene, start: cursor, end: cursor + scene.duration };
  cursor += scene.duration;
  return enriched;
});
const TOTAL_DURATION = cursor;
const TOTAL_FRAMES = TOTAL_DURATION * FPS;

type Runtime = {
  id: string;
  root: THREE.Group;
  update: (tLocal: number, camera: THREE.PerspectiveCamera) => void;
  cleanup: (scene: THREE.Scene) => void;
  previewTime?: number;
};

function timecode(seconds: number) {
  const whole = Math.floor(seconds + 1e-7);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}
function easeOutCubic(v: number) {
  return 1 - Math.pow(1 - clamp01(v), 3);
}
function easeInOutCubic(v: number) {
  v = clamp01(v);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp01(t);
}
function seededRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function stdMat(color: number, roughness = 0.88, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
}

function makeSkyTexture(top = "#203a66", bottom = "#f29b7a") {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTextSprite(lines: readonly string[], options?: { width?: number; height?: number; font?: number; bg?: string; color?: string }) {
  const width = options?.width ?? 768;
  const height = options?.height ?? 200;
  const font = options?.font ?? 44;
  const bg = options?.bg ?? "rgba(10,18,28,0.84)";
  const color = options?.color ?? "#ffffff";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.font = `700 ${font}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = font * 1.24;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, startY + idx * lineHeight);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3, (height / width) * 3, 1);
  return sprite;
}

function makeFullscreenCard(lines: string[], options?: { headlineColor?: string; bodyColor?: string; bgTop?: string; bgBottom?: string }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, options?.bgTop ?? "#08121d");
  grad.addColorStop(1, options?.bgBottom ?? "#101d16");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = options?.headlineColor ?? "#28d8ff";
  ctx.font = "700 84px Inter, Arial Black, sans-serif";
  if (lines[0]) ctx.fillText(lines[0], W / 2, 420);
  ctx.fillStyle = options?.bodyColor ?? "#ffffff";
  ctx.font = "700 76px Inter, Arial Black, sans-serif";
  if (lines[1]) ctx.fillText(lines[1], W / 2, 520);

  ctx.font = "700 44px Inter, Arial, sans-serif";
  let y = 760;
  for (let i = 2; i < lines.length; i++) {
    ctx.fillStyle = i < lines.length - 2 ? "#dff6ff" : "#93a4b8";
    ctx.fillText(lines[i], W / 2, y);
    y += 110;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  );
  mesh.renderOrder = 120;
  return mesh;
}

function createSubtitleOverlay() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  mesh.renderOrder = 999;

  let lastText: string | undefined;
  function draw(lines: readonly string[]) {
    const key = lines.join("\n");
    if (key === lastText) return;
    lastText = key;
    ctx.clearRect(0, 0, W, H);
    mesh.visible = lines.length > 0;
    ctx.font = "600 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const rows: string[] = [];
    for (const line of lines) {
      let row = "";
      for (const word of line.split(/\s+/)) {
        const next = row ? `${row} ${word}` : word;
        if (row && ctx.measureText(next).width > W * 0.82) {
          rows.push(row);
          row = word;
        } else row = next;
      }
      rows.push(row);
    }
    if (rows.length) {
      const height = rows.length * 64 + 32;
      const top = H * 0.91 - height;
      ctx.fillStyle = "rgba(9,19,31,0.91)";
      ctx.fillRect(W * 0.06, top, W * 0.88, height);
      ctx.fillStyle = "#73dfd5";
      ctx.fillRect(W * 0.06, top, 7, height);
      ctx.fillStyle = "#fff";
      rows.forEach((row, i) => ctx.fillText(row, W / 2, top + 48 + i * 64));
    }
    tex.needsUpdate = true;
  }

  return { mesh, draw };
}

function makeGrainPass(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uFrame: { value: 0 },
      uResolution: { value: new THREE.Vector2(W, H) },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position,1.0);}`,
    fragmentShader: `
      uniform float uFrame;
      uniform vec2 uResolution;
      varying vec2 vUv;
      float rand(vec2 co, float seed) {
        return fract(sin(dot(co + seed, vec2(12.9898, 78.233))) * 43758.5453);
      }
      void main() {
        float grain = rand(gl_FragCoord.xy / uResolution, uFrame * 0.013) * 0.07;
        vec2 uv = vUv - 0.5;
        float vig = 1.0 - dot(uv * 1.24, uv * 1.24);
        vig = clamp(vig, 0.0, 1.0);
        float alpha = (1.0 - vig) * 0.52 + grain;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return {
    render(frame: number) {
      material.uniforms.uFrame.value = frame;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
    },
  };
}

function createCharacter() {
  const root = new THREE.Group();
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), stdMat(0xd3a06d, 0.92));
  head.position.y = 1.74;
  head.name = "head";
  root.add(head);

  const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), stdMat(0x18120f, 0.95));
  hair.position.set(0, 1.94, -0.04);
  hair.scale.set(1.18, 0.72, 1.05);
  root.add(hair);

  // Color the front face directly: overlapping jacket panels flickered at a distance.
  const jacket = stdMat(PALETTE.teal, 0.82);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 0.34),
    [jacket, jacket, jacket, jacket, stdMat(PALETTE.warm, 0.78), jacket]);
  torso.position.y = 1.08;
  root.add(torso);

  const armGeo = new THREE.BoxGeometry(0.2, 0.62, 0.2);
  const legGeo = new THREE.BoxGeometry(0.24, 0.7, 0.24);
  const lArm = new THREE.Mesh(armGeo, stdMat(PALETTE.teal, 0.82));
  lArm.name = "lArm";
  lArm.position.set(-0.44, 1.06, 0);
  root.add(lArm);
  const rArm = new THREE.Mesh(armGeo, stdMat(PALETTE.teal, 0.82));
  rArm.name = "rArm";
  rArm.position.set(0.44, 1.06, 0);
  root.add(rArm);
  const lLeg = new THREE.Mesh(legGeo, stdMat(0x233142, 0.84));
  lLeg.name = "lLeg";
  lLeg.position.set(-0.16, 0.42, 0);
  root.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, stdMat(0x233142, 0.84));
  rLeg.name = "rLeg";
  rLeg.position.set(0.16, 0.42, 0);
  root.add(rLeg);

  const shoeGeo = new THREE.BoxGeometry(0.26, 0.12, 0.34);
  const lShoe = new THREE.Mesh(shoeGeo, stdMat(0x0f1116));
  lShoe.position.set(-0.16, 0.06, 0.07);
  root.add(lShoe);
  const rShoe = new THREE.Mesh(shoeGeo, stdMat(0x0f1116));
  rShoe.position.set(0.16, 0.06, 0.07);
  root.add(rShoe);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return root;
}

function animateWalk(char: THREE.Group, t: number, speed = 3.1) {
  const swing = Math.sin(t * speed) * 0.42;
  const bob = Math.abs(Math.sin(t * speed)) * 0.04;
  const lLeg = char.getObjectByName("lLeg");
  const rLeg = char.getObjectByName("rLeg");
  const lArm = char.getObjectByName("lArm");
  const rArm = char.getObjectByName("rArm");
  const head = char.getObjectByName("head");
  if (lLeg) lLeg.rotation.x = swing;
  if (rLeg) rLeg.rotation.x = -swing;
  if (lArm) lArm.rotation.x = -swing * 0.68;
  if (rArm) rArm.rotation.x = swing * 0.68;
  if (head) head.rotation.y = Math.sin(t * 0.75) * 0.08;
  char.position.y = bob;
}

function createCloud(seed: number, color = 0xe9efff) {
  const root = new THREE.Group();
  const rng = seededRng(seed);
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rng() * 0.5, 0), stdMat(color, 1));
    puff.position.set((i - 2) * 0.45 + (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.2);
    puff.scale.set(1 + rng() * 0.5, 0.7 + rng() * 0.22, 0.9 + rng() * 0.3);
    root.add(puff);
  }
  return root;
}

function createBackdrop(root: THREE.Group, options?: { dusk?: boolean; sun?: boolean; mountains?: boolean; water?: boolean }) {
  if (options?.water) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(150, 42), stdMat(0x2a567a, 0.28, 0.08));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.02, -42);
    root.add(water);
  }

  if (options?.mountains) {
    const rng = seededRng(812);
    for (let i = 0; i < 10; i++) {
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(4 + rng() * 4.5, 7 + rng() * 8, 5 + Math.floor(rng() * 4)),
        stdMat(i % 2 === 0 ? 0x49557a : 0x6b5872, 0.98)
      );
      mountain.position.set(-34 + i * 7.3, 3.5, -30 - rng() * 12);
      mountain.rotation.y = rng() * Math.PI;
      root.add(mountain);
    }
  }

  if (options?.sun) {
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2.3, 18, 18), new THREE.MeshBasicMaterial({ color: options?.dusk ? 0xffc18e : 0xffe29d }));
    sun.position.set(16, 18, -44);
    root.add(sun);
  }

  const clouds = [createCloud(1), createCloud(2), createCloud(3)];
  clouds[0].position.set(-16, 18, -32);
  clouds[1].position.set(8, 15, -25);
  clouds[2].position.set(22, 20, -38);
  clouds.forEach((cloud) => root.add(cloud));
  const origins = clouds.map(cloud => cloud.position.x);
  return (t: number) => clouds.forEach((cloud, i) => {
    cloud.position.x = origins[i] + Math.sin(t * 0.055 + i) * 3;
  });
}

function createGround(root: THREE.Group, size = 180, color = PALETTE.grass) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), stdMat(color, 0.98));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);
  return ground;
}

function createRoadGrid(root: THREE.Group, blocks = 3, spacing = 12, roadWidth = 2.6) {
  const roadMat = stdMat(PALETTE.road, 0.94);
  const lineMat = stdMat(PALETTE.roadMark, 0.8);
  for (let i = -blocks; i <= blocks; i++) {
    const roadX = new THREE.Mesh(new THREE.BoxGeometry(blocks * spacing * 2 + spacing * 1.4, 0.08, roadWidth), roadMat);
    roadX.position.set(0, 0.02, i * spacing);
    roadX.receiveShadow = true;
    root.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 0.08, blocks * spacing * 2 + spacing * 1.4), roadMat);
    roadZ.position.set(i * spacing, 0.02, 0);
    roadZ.receiveShadow = true;
    root.add(roadZ);

    for (let j = -blocks * 4; j <= blocks * 4; j++) {
      if (j % 2 !== 0 || (j * 3) % spacing === 0) continue;
      const dashX = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 0.12), lineMat);
      dashX.position.set(j * 3, 0.06, i * spacing);
      root.add(dashX);
      const dashZ = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 1.25), lineMat);
      dashZ.position.set(i * spacing, 0.06, j * 3);
      root.add(dashZ);
    }
  }
  const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.23, 0.02, 0.78), lineMat, 20);
  const stripe = new THREE.Object3D();
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const offset = (i - 2) * 0.44;
      stripe.position.set(offset * Math.cos(angle) + 2.15 * Math.sin(angle), 0.085,
        2.15 * Math.cos(angle) - offset * Math.sin(angle));
      stripe.rotation.y = angle;
      stripe.updateMatrix();
      stripes.setMatrixAt(side * 5 + i, stripe.matrix);
    }
  }
  root.add(stripes);
}

function fallbackHouseModel() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.9), stdMat(0x6c90d2));
  body.position.y = 0.75;
  root.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 4), stdMat(PALETTE.warm));
  roof.position.y = 1.82;
  roof.rotation.y = Math.PI / 4;
  root.add(roof);
  return root;
}
function fallbackTreeModel() {
  const root = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.55, 5), stdMat(0x7a5a30));
  trunk.position.y = 0.28;
  root.add(trunk);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 6), stdMat(0x2f8f48));
  leaves.position.y = 1;
  root.add(leaves);
  return root;
}
function fallbackBottleModel() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x73bfff, transparent: true, opacity: 0.84, roughness: 0.16, flatShading: true }));
  body.position.y = 0.31;
  root.add(body);
  return root;
}
function fallbackRadioModel() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.36, 0.28), stdMat(0x394048));
  body.position.y = 0.18;
  root.add(body);
  return root;
}
function fallbackBoardModel() {
  const root = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.14), stdMat(0x934f31));
  board.position.y = 1.45;
  root.add(board);
  return root;
}

function getModel(models: ModelLibrary | null, key: keyof ModelLibrary) {
  if (models) return cloneModel(models[key]);
  if (key === "house") return fallbackHouseModel();
  if (key === "tree") return fallbackTreeModel();
  if (key === "bottle") return fallbackBottleModel();
  if (key === "radio") return fallbackRadioModel();
  return fallbackBoardModel();
}

function retintHouse(instance: THREE.Object3D, wallColor: number, roofColor: number) {
  instance.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = obj.name.toLowerCase();
    if (name.includes("roof")) mesh.material = stdMat(roofColor, 0.88);
    else if (name.includes("frame")) mesh.material = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x1d4f85, emissiveIntensity: 0.28, roughness: 0.24, flatShading: true });
    else if (name.includes("door")) mesh.material = stdMat(0x23262e, 0.92);
    else mesh.material = stdMat(wallColor, 0.92);
  });
}

function placeHouse(root: THREE.Group, models: ModelLibrary | null, x: number, z: number, seed: number, scale = 1) {
  const rng = seededRng(seed);
  const instance = getModel(models, "house");
  const wallColors = [0x6f8fca, 0x8f73d8, 0xd88f68, 0x61b487];
  const roofColors = [0x375a84, 0x6a4696, 0x934f31, 0x2d7a53];
  const idx = Math.floor(rng() * wallColors.length);
  retintHouse(instance, wallColors[idx], roofColors[idx]);
  const s = scale * (0.86 + rng() * 0.7);
  instance.scale.multiplyScalar(s);
  instance.position.set(x, 0, z);
  instance.rotation.y = rng() * 0.3;
  root.add(instance);
  return instance;
}

function placeTree(root: THREE.Group, models: ModelLibrary | null, x: number, z: number, seed: number, scale = 1) {
  const rng = seededRng(seed);
  const instance = getModel(models, "tree");
  instance.scale.multiplyScalar(scale * (0.78 + rng() * 0.65));
  instance.position.set(x, 0, z);
  instance.rotation.y = rng() * Math.PI;
  root.add(instance);
  return instance;
}

function placeBottle(root: THREE.Group, models: ModelLibrary | null, x: number, y: number, z: number, scale = 1) {
  const bottle = getModel(models, "bottle");
  bottle.scale.multiplyScalar(scale);
  bottle.position.set(x, y, z);
  root.add(bottle);
  return bottle;
}

function placeRadio(root: THREE.Group, models: ModelLibrary | null, x: number, y: number, z: number, scale = 1) {
  const radio = getModel(models, "radio");
  radio.scale.multiplyScalar(scale);
  radio.position.set(x, y, z);
  root.add(radio);
  return radio;
}

function placeBoard(root: THREE.Group, models: ModelLibrary | null, x: number, z: number, scale = 1) {
  const board = getModel(models, "board");
  board.scale.multiplyScalar(scale);
  board.position.set(x, 0, z);
  root.add(board);
  return board;
}

function populateCity(root: THREE.Group, models: ModelLibrary | null, blocks: number, seed = 1) {
  const rng = seededRng(seed);
  const spacing = 12;
  for (let gx = -blocks; gx <= blocks; gx++) {
    for (let gz = -blocks; gz <= blocks; gz++) {
      if (Math.abs(gx) + Math.abs(gz) < 1) continue;
      const centerX = (gx + 0.5) * spacing;
      const centerZ = (gz + 0.5) * spacing;
      const count = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < count; i++) {
        const x = centerX + (rng() - 0.5) * 6.8;
        const z = centerZ + (rng() - 0.5) * 6.8;
        placeHouse(root, models, x, z, seed * 100 + gx * 31 + gz * 17 + i, 0.9 + rng() * 0.5);
      }
      const treeCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < treeCount; i++) {
        const edge = i % 2 === 0 ? 4.3 : -4.3;
        placeTree(root, models, centerX + edge, centerZ + (rng() - 0.5) * 8, seed * 500 + i + gx * 5 + gz * 11, 0.8 + rng() * 0.6);
      }
    }
  }
}

function createGermanyMapGroup() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  const pts: [number, number][] = [
    [0.4, 5.1], [0.9, 5.35], [1.45, 5.56], [2.0, 5.46], [2.48, 5.62], [3.1, 5.38], [3.62, 4.95],
    [3.95, 4.42], [4.14, 3.95], [4.28, 3.3], [4.14, 2.78], [3.82, 2.12], [3.58, 1.58], [3.12, 1.0],
    [2.68, 0.56], [2.18, 0.16], [1.6, 0.0], [1.04, 0.14], [0.58, 0.45], [0.25, 0.92], [0.0, 1.52],
    [-0.2, 2.15], [-0.26, 2.78], [-0.1, 3.36], [0.03, 3.98], [0.16, 4.52], [0.4, 5.1],
  ];
  const scale = 1.34;
  shape.moveTo(pts[0][0] * scale - 2.7, pts[0][1] * scale - 3.8);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] * scale - 2.7, pts[i][1] * scale - 3.8);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, stdMat(PALETTE.mapBase, 0.86));
  mesh.rotation.x = -Math.PI / 2;
  group.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: PALETTE.mapGlow })
  );
  edges.rotation.x = -Math.PI / 2;
  group.add(edges);

  for (let i = -4; i <= 4; i++) {
    const x = i * 0.62;
    const l1 = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.08, -4), new THREE.Vector3(x, 0.08, 4)]),
      new THREE.LineBasicMaterial({ color: 0x24527f, transparent: true, opacity: 0.34 })
    );
    group.add(l1);
    const z = i * 0.62;
    const l2 = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4, 0.08, z), new THREE.Vector3(4, 0.08, z)]),
      new THREE.LineBasicMaterial({ color: 0x24527f, transparent: true, opacity: 0.34 })
    );
    group.add(l2);
  }

  return group;
}

function createBlastRings() {
  const root = new THREE.Group();
  const data = [
    { r: 0.22, color: PALETTE.red },
    { r: 0.36, color: PALETTE.orange },
    { r: 0.68, color: PALETTE.yellow },
  ];
  data.forEach((entry) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(entry.r - 0.015, entry.r + 0.015, 64),
      new THREE.MeshBasicMaterial({ color: entry.color, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    root.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(entry.r - 0.015, 64),
      new THREE.MeshBasicMaterial({ color: entry.color, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.09;
    root.add(disc);
  });
  return root;
}

class OrbitController {
  phi = 1.04;
  theta = 0.45;
  radius = 24;
  target = new THREE.Vector3(0, 2, 0);
  private dragging = false;
  private px = 0;
  private py = 0;
  private button = 0;
  private prevTouchDist = 0;
  private prevTouchX = 0;
  private prevTouchY = 0;

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true;
    this.px = e.clientX;
    this.py = e.clientY;
    this.button = e.button;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.px;
    const dy = e.clientY - this.py;
    this.px = e.clientX;
    this.py = e.clientY;
    if (this.button === 0) {
      this.theta -= dx * 0.008;
      this.phi -= dy * 0.008;
      this.phi = Math.max(0.08, Math.min(Math.PI - 0.08, this.phi));
    } else if (this.button === 2) {
      const viewDir = new THREE.Vector3().subVectors(this.camera.position, this.target).normalize();
      const right = new THREE.Vector3().crossVectors(viewDir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      this.target.addScaledVector(right, -dx * this.radius * 0.0025);
      this.target.addScaledVector(up, dy * this.radius * 0.0025);
    }
  };
  private onMouseUp = () => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.radius *= 1 + e.deltaY * 0.001;
    this.radius = Math.max(2, Math.min(85, this.radius));
  };
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.prevTouchX = e.touches[0].clientX;
      this.prevTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this.prevTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.prevTouchX;
      const dy = e.touches[0].clientY - this.prevTouchY;
      this.theta -= dx * 0.01;
      this.phi -= dy * 0.01;
      this.phi = Math.max(0.08, Math.min(Math.PI - 0.08, this.phi));
      this.prevTouchX = e.touches[0].clientX;
      this.prevTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      this.radius *= this.prevTouchDist / dist;
      this.radius = Math.max(2, Math.min(85, this.radius));
      this.prevTouchDist = dist;
    }
  };

  constructor(private camera: THREE.PerspectiveCamera, private element: HTMLElement) {
    element.addEventListener("mousedown", this.onMouseDown);
    element.addEventListener("mousemove", this.onMouseMove);
    element.addEventListener("mouseup", this.onMouseUp);
    element.addEventListener("mouseleave", this.onMouseUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("touchstart", this.onTouchStart, { passive: false });
    element.addEventListener("touchmove", this.onTouchMove, { passive: false });
    element.addEventListener("touchend", this.onMouseUp);
  }

  update() {
    const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.element.removeEventListener("mousedown", this.onMouseDown);
    this.element.removeEventListener("mousemove", this.onMouseMove);
    this.element.removeEventListener("mouseup", this.onMouseUp);
    this.element.removeEventListener("mouseleave", this.onMouseUp);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("touchstart", this.onTouchStart);
    this.element.removeEventListener("touchmove", this.onTouchMove);
    this.element.removeEventListener("touchend", this.onMouseUp);
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitController | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const frameRef = useRef(0);
  const rafRef = useRef(0);
  const startTimeRef = useRef(0);
  const playModeRef = useRef<"editor" | "film" | "preview">("editor");
  const modelsRef = useRef<ModelLibrary | null>(null);
  const subtitleRef = useRef<ReturnType<typeof createSubtitleOverlay> | null>(null);
  const subtitleSceneRef = useRef<THREE.Scene | null>(null);
  const subtitleCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const grainRef = useRef<ReturnType<typeof makeGrainPass> | null>(null);
  const skyTexturesRef = useRef<{ day?: THREE.Texture; dusk?: THREE.Texture; night?: THREE.Texture }>({});

  const [status, setStatus] = useState("Lade Modelle und baue den Viewport …");
  const [progress, setProgress] = useState(0);
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [fmts, setFmts] = useState({ mp4: "", webm: "" });
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activePanelScene, setActivePanelScene] = useState("MAP");
  const [modelsReady, setModelsReady] = useState(false);

  const sound = useRef<AudioContext | null>(null);
  const voice = useRef<AudioBuffer | null>(null);
  const speaker = useRef<AudioBufferSourceNode | null>(null);
  const mix = useRef<MediaStreamAudioDestinationNode | null>(null);
  const [voiceName, setVoiceName] = useState("");
  const [loadingVoice, setLoadingVoice] = useState(false);
  function silence() { speaker.current?.stop(); speaker.current?.disconnect(); speaker.current = null; }
  async function importVoice(file?: File) {
    if (!file) return;
    setLoadingVoice(true);
    try {
      const ctx = sound.current ??= new AudioContext();
      await ctx.resume();
      const audio = await ctx.decodeAudioData(await file.arrayBuffer());
      mix.current ??= ctx.createMediaStreamDestination();
      voice.current = audio;
      setVoiceName(file.name);
    } catch { setStatus("Audiodatei nicht lesbar. Bitte WAV oder MP3 wählen."); }
    finally { setLoadingVoice(false); }
  }
  const recorderRef = useRef<MediaRecorder | null>(null);

  function setSceneBackground(kind: "day" | "dusk" | "night") {
    const scene = sceneRef.current;
    if (!scene) return;
    if (kind === "day") scene.background = skyTexturesRef.current.day ?? new THREE.Color(0x7eb7ff);
    if (kind === "dusk") scene.background = skyTexturesRef.current.dusk ?? new THREE.Color(0x2f335a);
    if (kind === "night") scene.background = skyTexturesRef.current.night ?? new THREE.Color(0x091018);
  }

  function clearRuntime() {
    const scene = sceneRef.current;
    if (!scene) return;
    if (runtimeRef.current) {
      runtimeRef.current.cleanup(scene);
      scene.remove(runtimeRef.current.root);
      runtimeRef.current = null;
    }
    scene.fog = null;
  }

  function buildEditorRuntime(): Runtime {
    const root = new THREE.Group();
    root.name = "editorRoot";
    setSceneBackground("dusk");
    createGround(root, 220, PALETTE.grassDark);
    const driftClouds = createBackdrop(root, { dusk: true, sun: true, mountains: true, water: true });
    createRoadGrid(root, 3, 12, 2.8);
    populateCity(root, modelsRef.current, 2, 123);

    for (let i = -5; i <= 5; i++) {
      placeTree(root, modelsRef.current, i * 4.8, 8.8, 900 + i, 1.1);
      placeTree(root, modelsRef.current, i * 4.8, -8.8, 950 + i, 1.05);
      placeTree(root, modelsRef.current, 8.8, i * 4.8, 1000 + i, 1.0);
      placeTree(root, modelsRef.current, -8.8, i * 4.8, 1050 + i, 1.0);
    }

    const char = createCharacter();
    char.name = "editorChar";
    char.position.set(0, 0, 0);
    root.add(char);

    const mapPad = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 0.4, 6), stdMat(0x182232, 0.82));
    mapPad.position.set(19.5, 0.2, -19.5);
    root.add(mapPad);

    const mapGroup = createGermanyMapGroup();
    mapGroup.name = "editorMap";
    mapGroup.position.set(19.5, 0.42, -19.5);
    mapGroup.scale.setScalar(2.8);
    root.add(mapGroup);

    const rings = createBlastRings();
    rings.name = "editorRings";
    rings.position.set(20.3, 0.42, -18.95);
    rings.scale.setScalar(2.8);
    root.add(rings);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshStandardMaterial({ color: PALETTE.red, emissive: PALETTE.red, emissiveIntensity: 1.4 })
    );
    dot.name = "editorDot";
    dot.position.set(20.3, 1.08, -18.95);
    root.add(dot);

    const title = makeTextSprite(["MITTELSTADT A.", "Interaktive Map · Preview"], { font: 34, width: 700, height: 180, bg: "rgba(10,18,28,0.78)", color: "#dff7ff" });
    title.position.set(19.5, 4.2, -15.5);
    root.add(title);

    const board = placeBoard(root, modelsRef.current, -10.5, -11.5, 1.2);
    board.rotation.y = Math.PI * 0.15;

    const infoCard = makeTextSprite(["Nachbarschaftstreff", "Information und Hilfe"], { font: 30, width: 720, height: 160, bg: "rgba(7,16,28,0.82)" });
    infoCard.position.set(-10.5, 3.8, -11.5);
    root.add(infoCard);

    return {
      id: "MAP",
      root,
      previewTime: 0,
      update: (tLocal, camera) => {
        // Follow the central avenue, facing the tangent as the walker turns.
        driftClouds(tLocal);
        const phase = tLocal * 0.24;
        char.position.x = 0.7 * Math.sin(phase);
        char.position.z = 5 * Math.cos(phase);
        char.rotation.y = Math.atan2(0.7 * Math.cos(phase), -5 * Math.sin(phase));
        animateWalk(char, tLocal, 2.5);
        dot.scale.setScalar(1 + Math.sin(tLocal * 5) * 0.25);
        dot.position.y = 1.08 + Math.sin(tLocal * 3) * 0.08;
        const mapRot = Math.sin(tLocal * 0.3) * 0.03;
        mapGroup.rotation.y = mapRot;
        rings.rotation.y = -mapRot * 1.2;
        void camera;
      },
      cleanup: () => {},
    };
  }

  function buildHookRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("dusk");
    // Amber light catches the roofs; atmospheric perspective keeps the foreground clear.
    const haze = new THREE.FogExp2(0xd5703a, 0.028);
    const amber = new THREE.DirectionalLight(0xff8b36, 1.9);
    amber.position.set(-9, 7, -15);
    root.add(amber);
    const ashPositions = new Float32Array(72 * 3);
    const seeds = seededRng(204);
    for (let i = 0; i < ashPositions.length; i += 3) {
      ashPositions[i] = (seeds() - 0.5) * 15;
      ashPositions[i + 1] = seeds() * 6;
      ashPositions[i + 2] = -12 + seeds() * 16;
    }
    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute("position", new THREE.BufferAttribute(ashPositions, 3));
    const ashMat = new THREE.PointsMaterial({ color: 0xffbb72, size: 0.035, transparent: true, depthWrite: false });
    const ash = new THREE.Points(ashGeo, ashMat);
    root.add(ash);
    createGround(root, 180, PALETTE.grassDark);
    createBackdrop(root, { dusk: true, sun: true, mountains: true, water: true });
    createRoadGrid(root, 2, 12, 2.7);
    populateCity(root, modelsRef.current, 2, 701);

    const char = createCharacter();
    char.position.set(-1.2, 0, 4);
    root.add(char);

    const heroTitle = makeTextSprite(["30 TAGE.", "Was passiert dann?"], { width: 860, height: 210, font: 54, bg: "rgba(8,14,22,0.76)" });
    heroTitle.position.set(0, 5.4, -4.2);
    root.add(heroTitle);

    const mapPad = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.4, 0.32, 6), stdMat(0x182232, 0.84));
    mapPad.position.set(0, 0.25, -11.5);
    root.add(mapPad);
    const map = createGermanyMapGroup();
    map.position.set(0, 0.42, -11.5);
    map.scale.setScalar(2.2);
    map.visible = false;
    root.add(map);
    const rings = createBlastRings();
    rings.position.set(0.68, 0.42, -10.95);
    rings.scale.setScalar(0);
    rings.visible = false;
    root.add(rings);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), new THREE.MeshStandardMaterial({ color: PALETTE.red, emissive: PALETTE.red, emissiveIntensity: 1.5 }));
    dot.position.set(0.68, 0.95, -10.95);
    dot.visible = false;
    root.add(dot);

    const card1 = makeTextSprite(["ca. 1,6 km · 5 psi", "Schwere Schäden"], { font: 28, width: 560, height: 140, bg: "rgba(120,20,20,0.86)" });
    card1.position.set(2.9, 2.1, -10.2);
    card1.visible = false;
    root.add(card1);
    const card2 = makeTextSprite(["ca. 4,5 km · 1 psi", "Fensterschäden"], { font: 28, width: 560, height: 140, bg: "rgba(160,90,12,0.86)" });
    card2.position.set(2.9, 3.05, -10.65);
    card2.visible = false;
    root.add(card2);

    return {
      id: "s01_hook",
      root,
      previewTime: 1.5,
      update: (tLocal, camera) => {
        const warmth = 1 - easeInOutCubic((tLocal - 1.7) / 2.1);
        haze.density = 0.028 * warmth;
        sceneRef.current!.fog = warmth > 0 ? haze : null;
        amber.intensity = warmth * (1.6 + 0.6 * Math.sin(Math.min(tLocal, 2.8) * 1.1));
        ash.visible = warmth > 0;
        ashMat.opacity = 0.78 * warmth;
        ash.position.set(tLocal * 0.24, tLocal * 0.12, Math.sin(tLocal * 0.8) * 0.22);
        animateWalk(char, tLocal, 2.5);
        if (tLocal < 2.8) {
          char.visible = true;
          map.visible = rings.visible = dot.visible = card1.visible = card2.visible = false;
          char.position.z = 4 - tLocal * 0.55;
          camera.position.set(-2.2 + tLocal * 0.35, 2.5, 8 - tLocal * 0.7);
          camera.lookAt(char.position.x, 1.4, char.position.z - 1.6);
          (heroTitle.material as THREE.SpriteMaterial).opacity = 1;
        } else {
          const p = easeInOutCubic((tLocal - 2.8) / 2.4);
          map.visible = true;
          rings.visible = true;
          dot.visible = true;
          char.visible = p < 0.7;
          camera.position.set(lerp(-1.4, 0.8, p), lerp(4.2, 7.2, p), lerp(3.6, -5.0, p));
          camera.lookAt(lerp(0, 0.1, p), 0.35, lerp(-5, -11.1, p));
          rings.scale.setScalar(easeOutCubic((tLocal - 3.4) / 1.8));
          dot.scale.setScalar(1 + Math.sin(tLocal * 7) * 0.35);
          dot.position.y = 0.95 + Math.sin(tLocal * 4) * 0.06;
          card1.visible = tLocal > 4.2;
          card2.visible = tLocal > 5.0;
          if (card1.visible) card1.scale.setScalar(easeOutCubic((tLocal - 4.2) / 0.8) * 2.2);
          if (card2.visible) card2.scale.setScalar(easeOutCubic((tLocal - 5.0) / 0.8) * 2.2);
          (heroTitle.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - p * 1.1);
        }
      },
      cleanup: () => { ashGeo.dispose(); ashMat.dispose(); amber.dispose(); },
    };
  }

  function buildBlastRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("dusk");
    createGround(root, 160, PALETTE.grassDark);
    createBackdrop(root, { dusk: true, sun: true, mountains: true, water: false });
    createRoadGrid(root, 2, 12, 2.8);
    populateCity(root, modelsRef.current, 2, 880);
    const char = createCharacter();
    char.position.set(0, 0, 4);
    root.add(char);

    const streetLamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), stdMat(0x434b55));
    streetLamp.position.set(2.2, 1.6, -2.4);
    root.add(streetLamp);
    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.18), stdMat(0xd9b86a, 0.5));
    lampHead.position.set(2.45, 3.0, -2.4);
    root.add(lampHead);

    // Localized, soft-edged light behind the skyline instead of a white screen.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const ctx = glowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "#fff1b6");
    gradient.addColorStop(0.22, "rgba(255,175,74,.85)");
    gradient.addColorStop(0.55, "rgba(244,92,40,.38)");
    gradient.addColorStop(1, "rgba(244,92,40,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(glowCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(-5, 4, -24);
    root.add(glow);
    const fill = new THREE.DirectionalLight(0xffbb73, 0);
    fill.position.copy(glow.position);
    root.add(fill);

    const debrisGeo = new THREE.BufferGeometry();
    const debrisPositions = new Float32Array(360 * 3);
    const basePositions = new Float32Array(360 * 3);
    const rng = seededRng(47);
    for (let i = 0; i < basePositions.length; i += 3) {
      basePositions[i] = (rng() - 0.5) * 6;
      basePositions[i + 1] = rng() * 3 + 0.5;
      basePositions[i + 2] = -4 + (rng() - 0.5) * 6;
    }
    debrisPositions.set(basePositions);
    debrisGeo.setAttribute("position", new THREE.BufferAttribute(debrisPositions, 3));
    const debris = new THREE.Points(debrisGeo, new THREE.PointsMaterial({ color: 0xbd997f, size: 0.08, transparent: true, opacity: 0.76 }));
    debris.frustumCulled = false;
    debris.visible = false;
    root.add(debris);

    return {
      id: "s02_blast",
      root,
      previewTime: 6.8,
      update: (tLocal, camera) => {
        const walkTime = Math.min(tLocal, 5.1);
        animateWalk(char, walkTime, 3.6);
        char.position.z = 4 - walkTime * 0.45;
        camera.position.set(1.5, char.position.y + 2.5, char.position.z + 3.8);
        camera.lookAt(char.position.x, 1.5, char.position.z - 1.2);

        const age = Math.max(0, tLocal - 4.95);
        const pulse = easeInOutCubic(age / 0.45) * (1 - easeInOutCubic((age - 0.45) / 3.8));
        glow.visible = pulse > 0;
        glow.material.opacity = pulse * 0.92;
        glow.scale.setScalar(3 + 16 * easeOutCubic(age / 2.6));
        fill.intensity = pulse * 1.6;
        debris.visible = tLocal > 5.9 && tLocal < 13.9;
        if (debris.visible) {
          debris.material.opacity = 0.65 * easeInOutCubic((tLocal - 5.9) / 0.8)
            * (1 - easeInOutCubic((tLocal - 9.9) / 4));
          const pos = debris.geometry.attributes.position.array as Float32Array;
          const dt = tLocal - 5.9;
          for (let i = 0; i < pos.length; i += 3) {
            pos[i] = basePositions[i] + dt * 2.5;
            pos[i + 1] = basePositions[i + 1] + Math.sin(dt * 7 + i) * 0.3;
            pos[i + 2] = basePositions[i + 2] + dt * 0.2;
          }
          debris.geometry.attributes.position.needsUpdate = true;
        }
      },
      cleanup: () => { texture.dispose(); glow.material.dispose(); },
    };
  }

  function buildDustRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("night");
    createGround(root, 150, 0x21201b);
    createRoadGrid(root, 1, 12, 2.7);
    populateCity(root, modelsRef.current, 1, 910);
    const char = createCharacter();
    char.position.set(0, 0, 1.4);
    root.add(char);

    const shelter = new THREE.Group();
    const wallMat = stdMat(0x44464c, 0.93);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.12, 4.4), wallMat);
    floor.position.set(5, 0.06, -2);
    shelter.add(floor);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 4.4), wallMat);
    left.position.set(2.68, 1.3, -2);
    shelter.add(left);
    const right = left.clone();
    right.position.x = 7.32;
    shelter.add(right);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.6, 0.16), wallMat);
    back.position.set(5, 1.3, -4.12);
    shelter.add(back);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(4.95, 0.2, 4.55), wallMat);
    ceiling.position.set(5, 2.58, -2);
    shelter.add(ceiling);
    shelter.visible = false;
    root.add(shelter);

    const count = 800;
    const pos = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const rng = seededRng(191);
    for (let i = 0; i < base.length; i += 3) {
      base[i] = (rng() - 0.5) * 15;
      base[i + 1] = rng() * 5;
      base[i + 2] = (rng() - 0.5) * 15;
    }
    pos.set(base);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xb79f86, size: 0.08, transparent: true, opacity: 0.45 }));
    root.add(dust);

    return {
      id: "s03_dust",
      root,
      previewTime: 14,
      update: (tLocal, camera) => {
        animateWalk(char, tLocal * 0.75, 2.1);
        char.position.z = 1.4 - tLocal * 0.17;
        const shake = Math.sin(tLocal * 10) * 0.045;
        if (tLocal < 10) {
          camera.position.set(char.position.x + 0.95 + shake, 2.0 + Math.sin(tLocal * 2) * 0.04, char.position.z + 2.4);
          camera.lookAt(char.position.x, 1.45, char.position.z);
        } else {
          shelter.visible = true;
          camera.position.set(5.8, 2.3, 3.3);
          camera.lookAt(5, 1.1, -2.1);
        }
        const arr = dust.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] = base[i] + Math.sin(tLocal * 0.5 + i) * 0.04;
          arr[i + 1] = base[i + 1] + Math.sin(tLocal * 0.8 + i * 0.1) * 0.05;
          arr[i + 2] = base[i + 2] + Math.cos(tLocal * 0.6 + i * 0.12) * 0.04;
        }
        dust.geometry.attributes.position.needsUpdate = true;
      },
      cleanup: () => {},
    };
  }

  function buildFireRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("night");
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.9, 0.45, 6), stdMat(0x13253d, 0.84));
    pad.position.y = 0.22;
    root.add(pad);
    const map = createGermanyMapGroup();
    map.position.y = 0.42;
    map.scale.setScalar(2.8);
    root.add(map);
    const rings = createBlastRings();
    rings.position.set(0.7, 0.42, 0.55);
    root.add(rings);

    const labels = [
      makeTextSprite(["ca. 1,6 km", "5 psi"], { font: 28, width: 360, height: 120, bg: "rgba(150,30,35,0.9)" }),
      makeTextSprite(["ca. 2 km", "thermisch"], { font: 28, width: 360, height: 120, bg: "rgba(190,90,15,0.9)" }),
      makeTextSprite(["ca. 4,5 km", "1 psi"], { font: 28, width: 360, height: 120, bg: "rgba(120,90,15,0.9)" }),
      makeTextSprite(["Quelle: NUKEMAP · BBK", "Schätzwerte"], { font: 26, width: 560, height: 120, bg: "rgba(9,18,30,0.88)" }),
    ];
    labels[0].position.set(2.8, 1.2, 0.6);
    labels[1].position.set(2.7, 2.1, 0.0);
    labels[2].position.set(2.9, 3.05, -0.6);
    labels[3].position.set(-2.7, 0.95, -1.1);
    labels.forEach((l) => {
      l.scale.setScalar(0);
      root.add(l);
    });

    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(220 * 3);
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const fire = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0xff5c33, size: 0.08, transparent: true, opacity: 0.8 }));
    fire.position.set(0.7, 0.18, 0.55);
    root.add(fire);

    return {
      id: "s04_fire",
      root,
      previewTime: 8.6,
      update: (tLocal, camera) => {
        camera.position.set(Math.sin(tLocal * 0.16) * 1.5, 6.8, 6.2);
        camera.lookAt(0.25, 0.3, 0.25);
        rings.scale.setScalar(easeOutCubic(tLocal / 4));
        const arr = fire.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < arr.length / 3; i++) {
          const angle = tLocal * 2.3 + i * 0.14;
          const radius = 0.12 + (i / (arr.length / 3)) * 0.55;
          arr[i * 3] = Math.cos(angle) * radius;
          arr[i * 3 + 1] = Math.sin(tLocal * 2 + i) * 0.05;
          arr[i * 3 + 2] = Math.sin(angle) * radius;
        }
        fire.geometry.attributes.position.needsUpdate = true;
        labels.forEach((label, index) => {
          const delay = 4 + index * 1.2;
          label.scale.setScalar(easeOutCubic((tLocal - delay) / 0.9) * 2.15);
        });
      },
      cleanup: () => {},
    };
  }

  function buildWaterRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("night");
    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), stdMat(0x59442a, 0.92));
    floor.position.y = 0.05;
    root.add(floor);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(8, 4.2, 0.16), stdMat(0x232c38, 0.96));
    backWall.position.set(0, 2.1, -3.3);
    root.add(backWall);
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.2, 6.4), stdMat(0x1b2432, 0.96));
    sideWall.position.set(-3.8, 2.1, -0.1);
    root.add(sideWall);

    const char = createCharacter();
    char.position.set(-0.6, 0, 0.3);
    root.add(char);

    const table = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 1.15), stdMat(0x704725, 0.84));
    table.position.set(0.7, 0.74, -1.6);
    root.add(table);
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), stdMat(0x5a3920, 0.86));
    leg1.position.set(-0.8, 0.36, -1.2);
    root.add(leg1);
    const leg2 = leg1.clone(); leg2.position.set(2.15, 0.36, -2.0); root.add(leg2);

    for (let i = 0; i < 8; i++) {
      placeBottle(root, modelsRef.current, -1.1 + i * 0.32, 0.78, -1.6, 0.95);
    }
    placeRadio(root, modelsRef.current, 1.15, 0.82, -1.56, 0.95);
    const canister = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.22), stdMat(0x2f8f48, 0.78));
    canister.position.set(1.85, 1.0, -1.6);
    root.add(canister);
    const documentFolder = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.34), stdMat(0xf1e3bf, 0.78));
    documentFolder.position.set(2.45, 0.82, -1.55);
    root.add(documentFolder);

    const silhouette = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 1.9),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    silhouette.position.set(3.55, 1.08, 0.1);
    root.add(silhouette);

    // Soft window light separates the transparent bottles from the back wall.
    const windowLight = new THREE.PointLight(0xffedcf, 42, 15);
    windowLight.position.set(-1.6, 3.5, 1.4);
    root.add(windowLight);

    return {
      id: "s05_water",
      root,
      previewTime: 16.5,
      update: (tLocal, camera) => {
        const push = easeInOutCubic(tLocal / 25);
        camera.position.set(2.6 - push * 0.45, 3.0 - push * 0.18, 5.8 - push * 0.55);
        camera.lookAt(0.05, 1.05, -1.1);
        animateWalk(char, tLocal * 0.45, 1.3);
        char.position.x = -0.65 + Math.sin(tLocal * 0.38) * 0.26;
        if (tLocal > 14) {
          (silhouette.material as THREE.MeshBasicMaterial).opacity = easeOutCubic((tLocal - 14) / 2.4) * 0.75;
        }
      },
      cleanup: () => {},
    };
  }

  function buildPlumeRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("night");
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.9, 0.45, 6), stdMat(0x13253d, 0.84));
    pad.position.y = 0.22;
    root.add(pad);
    const map = createGermanyMapGroup();
    map.position.y = 0.42;
    map.scale.setScalar(2.8);
    map.rotation.z = 0.06;
    root.add(map);

    const count = 340;
    const original = new Float32Array(count * 3);
    const arr = new Float32Array(count * 3);
    const rng = seededRng(7010);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = t * 3.5;
      const width = Math.sin(t * Math.PI) * 0.72;
      original[i * 3] = x + (rng() - 0.5) * width * 0.55;
      original[i * 3 + 1] = 0.1 + (rng() - 0.5) * 0.04;
      original[i * 3 + 2] = (rng() - 0.5) * width;
    }
    arr.set(original);
    const plumeGeo = new THREE.BufferGeometry();
    plumeGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const plume = new THREE.Points(plumeGeo, new THREE.PointsMaterial({ color: 0xb7b45f, size: 0.08, transparent: true, opacity: 0.66 }));
    plume.position.set(0.7, 0.4, 0.55);
    root.add(plume);

    const arrows = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const x = 0.9 + i * 0.45;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.85, -1.1), new THREE.Vector3(x + 0.34, 0.85, -1.1)]),
        new THREE.LineBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.8 })
      );
      arrows.add(line);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4), new THREE.MeshBasicMaterial({ color: PALETTE.cyan }));
      head.position.set(x + 0.34, 0.85, -1.1);
      head.rotation.z = -Math.PI / 2;
      arrows.add(head);
    }
    root.add(arrows);

    const card = makeTextSprite(["14 Tage · Windrichtung bestimmt das Risiko", "Warnwege: NINA · Cell Broadcast · Radio"], { font: 28, width: 860, height: 150, bg: "rgba(9,18,30,0.88)" });
    card.position.set(0, 3.8, -1.2);
    root.add(card);

    return {
      id: "s06_plume",
      root,
      previewTime: 12,
      update: (tLocal, camera) => {
        camera.position.set(Math.sin(tLocal * 0.1) * 1.2, 7.0, 6.3);
        camera.lookAt(0.7, 0.25, 0.1);
        const positions = plume.geometry.attributes.position.array as Float32Array;
        const drift = (tLocal * 0.13) % 0.42;
        for (let i = 0; i < positions.length; i += 3) {
          positions[i] = original[i] + drift + Math.sin(tLocal * 0.6 + i * 0.02) * 0.02;
          positions[i + 1] = original[i + 1];
          positions[i + 2] = original[i + 2] + Math.cos(tLocal * 0.4 + i * 0.01) * 0.03;
        }
        plume.geometry.attributes.position.needsUpdate = true;
      },
      cleanup: () => {},
    };
  }

  function buildDay30Runtime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("day");
    createGround(root, 180, 0x68893b);
    createBackdrop(root, { dusk: false, sun: true, mountains: true, water: false });
    createRoadGrid(root, 2, 12, 2.8);
    populateCity(root, modelsRef.current, 2, 3200);

    for (let i = -4; i <= 4; i++) {
      placeTree(root, modelsRef.current, i * 3.8, 7.6, 4200 + i, 1.15);
      placeTree(root, modelsRef.current, i * 3.8, -7.6, 4300 + i, 1.15);
    }

    const board = placeBoard(root, modelsRef.current, 0.4, -2.9, 1.1);
    board.rotation.y = Math.PI * 0.02;
    const people: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const person = createCharacter();
      person.scale.setScalar(0.82);
      person.position.set(-2.4 + i * 1.65, 0, -3.5);
      root.add(person);
      people.push(person);
    }

    const main = createCharacter();
    main.position.set(-1.2, 0, 2.4);
    root.add(main);

    const table = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 1.2), stdMat(0x734827, 0.86));
    table.position.set(0.6, 0.85, -2.7);
    root.add(table);

    const title = makeTextSprite(["Tag 30", "Gemeinschaft & Aushang"], { font: 34, width: 620, height: 150, bg: "rgba(255,255,255,0.18)", color: "#ffffff" });
    title.position.set(-2.5, 3.9, -1.2);
    root.add(title);

    return {
      id: "s07_day30",
      root,
      previewTime: 9,
      update: (tLocal, camera) => {
        camera.position.set(2.3, 2.8, 5.2);
        camera.lookAt(0.15, 1.1, -1.0);
        if (tLocal < 10) {
          animateWalk(main, tLocal * 0.7, 1.8);
          main.position.z = 2.4 - tLocal * 0.14;
        }
        people.forEach((person, idx) => animateWalk(person, tLocal * 0.35 + idx * 0.6, 1.1 + idx * 0.08));
      },
      cleanup: () => {},
    };
  }

  function buildOutroRuntime(): Runtime {
    const root = new THREE.Group();
    setSceneBackground("night");
    const card = makeFullscreenCard([
      "VORBEREITUNG",
      "RETTET LEBEN.",
      "✓ Vorräte für 10 Tage",
      "✓ 2 Liter Wasser pro Person / Tag",
      "✓ Batterie-Radio und Taschenlampe",
      "✓ Dokumentenmappe · Bargeld · Medikamente",
      "bbk.bund.de/notfallvorsorge",
      "Quellen: NUKEMAP · BBK · FEMA · Schätzwerte",
    ]);
    root.add(card);
    return {
      id: "s08_outro",
      root,
      previewTime: 2,
      update: (tLocal, camera) => {
        camera.position.set(0, 0, 1);
        camera.lookAt(0, 0, 0);
        const material = card.material as THREE.MeshBasicMaterial;
        material.opacity = easeOutCubic(tLocal / 1.0);
      },
      cleanup: () => {},
    };
  }

  function buildRuntime(id: string) {
    if (id === "MAP") return buildEditorRuntime();
    if (id === "s01_hook") return buildHookRuntime();
    if (id === "s02_blast") return buildBlastRuntime();
    if (id === "s03_dust") return buildDustRuntime();
    if (id === "s04_fire") return buildFireRuntime();
    if (id === "s05_water") return buildWaterRuntime();
    if (id === "s06_plume") return buildPlumeRuntime();
    if (id === "s07_day30") return buildDay30Runtime();
    return buildOutroRuntime();
  }

  function mountRuntime(runtime: Runtime) {
    const scene = sceneRef.current!;
    clearRuntime();
    runtimeRef.current = runtime;
    scene.add(runtime.root);
  }


  function runEditorLoop() {
    cancelAnimationFrame(rafRef.current);
    playModeRef.current = "editor";
    frameRef.current = 0;
    setProgress(0);
    setActivePanelScene("MAP");
    mountRuntime(buildRuntime("MAP"));
    setStatus(modelsRef.current ? "Editor bereit — Karte und Stadt sind interaktiv." : "Editor bereit — Modelle laden nach …");
    subtitleRef.current?.draw([]);

    const loop = () => {
      if (playModeRef.current !== "editor") return;

      orbitRef.current?.update();
      runtimeRef.current?.update(performance.now() / 1000, cameraRef.current!);
      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  function getSceneForTime(t: number) {
    return SCENES.find((scene) => t >= scene.start && t < scene.end) ?? SCENES[SCENES.length - 1];
  }

  function renderFilmFrame(frame: number) {
    frameRef.current = frame;
    const t = frame / FPS;
    setProgress(frame / TOTAL_FRAMES);
    const sceneInfo = getSceneForTime(t);
    const camera = cameraRef.current!;
    if (!runtimeRef.current || runtimeRef.current.id !== sceneInfo.id) {
      mountRuntime(buildRuntime(sceneInfo.id));
      setActivePanelScene(sceneInfo.id);
    }
    runtimeRef.current?.update(t - sceneInfo.start, camera);
    subtitleRef.current?.draw(sceneInfo.subtitle);
    const renderer = rendererRef.current!;
    renderer.clear();
    renderer.render(sceneRef.current!, camera);
    grainRef.current?.render(frame);
    if (subtitleSceneRef.current && subtitleCameraRef.current) {
      renderer.autoClear = false;
      renderer.render(subtitleSceneRef.current, subtitleCameraRef.current);
      renderer.autoClear = true;
    }

  }

  function stopPlayback(toEditor = true) {
    silence();
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setRecording(false);
    playModeRef.current = toEditor ? "editor" : "preview";
    if (toEditor) {
      runEditorLoop();
    }
  }

  function playFilm(record = false, onFinish?: () => void) {
    cancelAnimationFrame(rafRef.current);
    playModeRef.current = "film";
    const firstFrame = record || frameRef.current >= TOTAL_FRAMES - 1 ? 0 : frameRef.current;
    silence();
    const ctx = sound.current;
    if (voice.current && ctx && mix.current && firstFrame / FPS < voice.current.duration) {
      void ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = voice.current;
      source.connect(ctx.destination);
      source.connect(mix.current);
      source.start(0, firstFrame / FPS);
      speaker.current = source;
    }
    let lastFrame = -1;
    setPlaying(true);
    setRecording(record);
    setProgress(0);
    setStatus(record ? "Aufnahme läuft …" : "Vorschau läuft …");
    startTimeRef.current = performance.now() - firstFrame * 1000 / FPS;

    const loop = () => {
      if (playModeRef.current !== "film") return;
      frameRef.current = Math.floor(((performance.now() - startTimeRef.current) / 1000) * FPS);

      if (frameRef.current >= TOTAL_FRAMES) {
        frameRef.current = TOTAL_FRAMES - 1;
        renderFilmFrame(frameRef.current);
        setProgress(1);
        setPlaying(false);
        setRecording(false);
        setStatus(record ? "Aufnahme fertig." : "Vorschau beendet.");
        playModeRef.current = "preview";
        silence();
        onFinish?.();
        return;
      }

      if (frameRef.current !== lastFrame) {
        renderFilmFrame(frameRef.current);
        lastFrame = frameRef.current;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    loop();
  }

  function handlePlay() {
    if (recording) return;
    if (playing) {
      stopPlayback(false);
      setStatus("Vorschau pausiert.");
    } else playFilm(false);
  }

  function handleRecord() {
    if (playing) return;
    const mimeType = format === "mp4" ? fmts.mp4 : fmts.webm;
    if (!mimeType || !rendererRef.current) {
      setStatus("Gewähltes Format ist nicht verfügbar.");
      return;
    }
    const stream = rendererRef.current.domElement.captureStream(30);
    if (voice.current && mix.current) mix.current.stream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    } catch {
      setStatus("MediaRecorder konnte nicht gestartet werden.");
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorderRef.current = recorder;
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tag30_1080x1920_${Date.now()}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    recorder.start(mimeType.includes("mp4") ? 1000 : undefined);
    playFilm(true, () => recorder.stop());
  }

  function handleStop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    playModeRef.current = "editor";
    setStatus("Gestoppt.");
    stopPlayback(true);
  }

  function jumpToScene(id: string) {
    if (playing) return;
    if (id === "MAP") { runEditorLoop(); return; }
    const scene = SCENES.find(item => item.id === id);
    if (!scene) return;
    cancelAnimationFrame(rafRef.current);
    playModeRef.current = "preview";
    mountRuntime(buildRuntime(id));
    setActivePanelScene(id);
    renderFilmFrame(Math.floor((scene.start + (runtimeRef.current?.previewTime ?? 0)) * FPS));
    setStatus(`Szenen-Vorschau: ${scene.label}`);
  }

  useEffect(() => {
    if (!mountRef.current) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.oncontextmenu = (event) => event.preventDefault();
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
    camera.position.set(14, 18, 22);
    cameraRef.current = camera;

    skyTexturesRef.current.day = makeSkyTexture("#4b87d9", "#d2efff");
    skyTexturesRef.current.dusk = makeSkyTexture("#253a67", "#f2a27f");
    skyTexturesRef.current.night = makeSkyTexture("#09111d", "#15263c");
    setSceneBackground("dusk");

    const ambient = new THREE.AmbientLight(0x55708f, 0.88);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x91c6ff, 0x324122, 0.62);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffdfbd, 1.55);
    dir.position.set(18, 24, 10);
    dir.castShadow = true;
    const shadowSize = navigator.maxTouchPoints > 1 ? 1024 : 2048;
    dir.shadow.mapSize.set(shadowSize, shadowSize);
    dir.shadow.camera.left = -60;
    dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 60;
    dir.shadow.camera.bottom = -60;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 150;
    scene.add(dir);

    orbitRef.current = new OrbitController(camera, renderer.domElement);
    orbitRef.current.target.set(0, 2.2, 0);
    orbitRef.current.radius = 26;
    orbitRef.current.theta = 0.5;
    orbitRef.current.phi = 1.05;

    const subtitleScene = new THREE.Scene();
    const subtitleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    subtitleSceneRef.current = subtitleScene;
    subtitleCameraRef.current = subtitleCamera;
    subtitleRef.current = createSubtitleOverlay();
    subtitleScene.add(subtitleRef.current.mesh);

    grainRef.current = makeGrainPass(renderer);

    const candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.42000a,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    if (typeof MediaRecorder !== "undefined") {
      setFmts({
        mp4: candidates.filter((c) => c.includes("mp4")).find((c) => MediaRecorder.isTypeSupported(c)) || "",
        webm: candidates.filter((c) => c.includes("webm")).find((c) => MediaRecorder.isTypeSupported(c)) || "",
      });
    }

    runEditorLoop();

    let disposed = false;
    loadModelLibrary()
      .then((library) => {
        if (disposed) return;
        modelsRef.current = library;
        setModelsReady(true);
        setStatus("Importierte Modelle geladen. Map-Viewport ist bereit.");
        if (playModeRef.current === "editor") runEditorLoop();
      })
      .catch(() => {
        setStatus("Modelle konnten nicht geladen werden. Fallback-Geometrie aktiv.");
      });

    const params = new URLSearchParams(window.location.search);
    const tParam = params.get("t");
    if (tParam) {
      const t = parseFloat(tParam);
      if (!Number.isNaN(t)) {
        setTimeout(() => {
          cancelAnimationFrame(rafRef.current);
          playModeRef.current = "preview";
          renderFilmFrame(Math.floor(t * FPS));
          setActivePanelScene(getSceneForTime(t).id);
          setStatus(`Zeit-Sprung zu ${t.toFixed(1)}s`);
        }, 250);
      }
    }

    const recordParam = params.get("record");
    const formatParam = params.get("format");
    if (formatParam === "mp4" || formatParam === "webm") setFormat(formatParam);
    if (recordParam === "1") {
      setTimeout(() => handleRecord(), 650);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      orbitRef.current?.dispose();
      silence();
      if (sound.current) void sound.current.close();
      disposed = true;
      renderer.domElement.remove();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="studio" style={{ display: "flex", width: "100vw", height: "100vh", background: "#0a0e14", color: "#c9d5e3", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ width: 190, background: "#10161f", borderRight: "1px solid #1b2a3a", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #1b2a3a", fontSize: 13, fontWeight: 700, letterSpacing: 1.2, color: "#f4f8ff" }}>HIERARCHY</div>
        <div
          onClick={() => jumpToScene("MAP")}
          style={{ padding: "10px 14px", cursor: "pointer", background: activePanelScene === "MAP" ? "#1d3450" : "transparent", borderLeft: activePanelScene === "MAP" ? "3px solid #28d8ff" : "3px solid transparent", color: activePanelScene === "MAP" ? "#ffffff" : "#9eb3c7", fontWeight: 700 }}
        >
          🗺 World / Map
          <div style={{ fontSize: 10, color: "#6982a0", marginTop: 4 }}>City + Germany platform</div>
        </div>
        {SCENES.map((scene) => (
          <div
            key={scene.id}
            onClick={() => jumpToScene(scene.id)}
            style={{ padding: "8px 14px 8px 24px", cursor: "pointer", background: activePanelScene === scene.id ? "#172637" : "transparent", borderLeft: activePanelScene === scene.id ? "3px solid #1495d0" : "3px solid transparent", color: activePanelScene === scene.id ? "#e9f7ff" : "#90a6ba", fontSize: 11, lineHeight: 1.45 }}
          >
            {scene.label}
            <div style={{ fontSize: 9, color: "#5b7186" }}>{scene.start}s – {scene.end}s</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ height: 38, display: "flex", alignItems: "center", gap: 14, padding: "0 14px", background: "#0d1219", borderBottom: "1px solid #1b2a3a" }}>
          <span style={{ color: "#28d8ff", fontWeight: 800, fontSize: 13, letterSpacing: 1.1 }}>TAG 30 ENGINE</span>
          <span style={{ fontSize: 12, color: "#7f96ac" }}>Low-Poly Crisis Preview</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: modelsReady ? "#70ffba" : "#ffcf70" }}>{modelsReady ? "OBJ Modelle geladen" : "OBJ Modelle werden geladen …"}</span>
        </div>

        <div className="stage" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1016", position: "relative" }}>
          <div className="screen" ref={mountRef} style={{ width: "min(390px, 92%)", height: "min(694px, 94%)", borderRadius: 10, overflow: "hidden", boxShadow: "0 0 0 1px rgba(40,216,255,0.18), 0 16px 60px rgba(0,0,0,0.55)" }} />

          {!playing && activePanelScene === "MAP" && (
            <div style={{ position: "absolute", top: 14, right: 18, background: "rgba(7,12,18,0.82)", border: "1px solid #203247", borderRadius: 8, padding: "10px 12px", fontSize: 11, lineHeight: 1.7, color: "#8fb5d8" }}>
              <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#28d8ff", fontWeight: 800, marginBottom: 4 }}>VIEWPORT</div>
              <div>LMB — Orbit</div>
              <div>RMB — Pan</div>
              <div>Scroll — Zoom</div>
              <div>Touch — Rotate / Pinch</div>
            </div>
          )}
        </div>

        <div style={{ background: "#0d1219", borderTop: "1px solid #1b2a3a", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="timecode">{timecode(progress * TOTAL_DURATION)}</span>
            <input className="timeline" type="range" aria-label="Filmposition" min={0} max={TOTAL_FRAMES - 1} step={1}
              value={Math.min(TOTAL_FRAMES - 1, Math.round(progress * TOTAL_FRAMES))} disabled={recording}
              aria-valuetext={timecode(progress * TOTAL_DURATION)} onChange={event => {
                stopPlayback(false);
                renderFilmFrame(event.currentTarget.valueAsNumber);
                setStatus("Standbild · Play setzt die Vorschau hier fort.");
              }} />
            <span className="timecode">{timecode(TOTAL_DURATION)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 160, fontSize: 11, color: "#8ca7c0" }}>{status}</span>
            {fmts.mp4 && <span style={{ padding: "2px 8px", fontSize: 10, borderRadius: 999, background: "rgba(26,120,70,0.28)", color: "#7af3ba", border: "1px solid #14573b" }}>MP4 ✓</span>}
            {fmts.webm && <span style={{ padding: "2px 8px", fontSize: 10, borderRadius: 999, background: "rgba(24,90,150,0.28)", color: "#80d4ff", border: "1px solid #1e4d73" }}>WebM ✓</span>}
            <label className="voice-input" title={voiceName || "Fish-Audio-Spur oder eigene Aufnahme importieren"}>
              {loadingVoice ? "Lädt …" : voiceName ? "♫ Spur wechseln" : "♫ Sprecher laden"}
              <input aria-label="Sprecherspur importieren" type="file" accept="audio/*,.wav,.mp3" disabled={playing || loadingVoice}
                onChange={event => { void importVoice(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {voiceName && <button disabled={playing || loadingVoice} onClick={() => {voice.current = null; setVoiceName("");}}>Ton entfernen</button>}
            <select value={format} onChange={(e) => setFormat(e.target.value as "mp4" | "webm")} style={{ background: "#10161f", color: "#d6e1ec", border: "1px solid #243447", borderRadius: 6, padding: "5px 7px", fontSize: 11 }}>
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
            </select>
            <button onClick={handlePlay} disabled={recording || loadingVoice} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #176387", background: playing ? "#1a2a36" : "#0d3f59", color: "#b7ecff", fontWeight: 800, fontSize: 12, cursor: playing ? "default" : "pointer" }}>{playing && !recording ? "Ⅱ PAUSE" : "▶ PLAY"}</button>
            <button onClick={handleRecord} disabled={playing || loadingVoice} style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #7a1b1b", background: recording ? "#7a1010" : playing ? "#231418" : "#421012", color: "#ffb7b7", fontWeight: 800, fontSize: 12, cursor: playing ? "default" : "pointer", boxShadow: recording ? "0 0 18px rgba(255,80,80,0.28)" : "none" }}>{recording ? "● REC" : "⏺ REC"}</button>
            <button onClick={handleStop} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #314355", background: "#131a23", color: "#a5b9cd", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>■ STOP</button>
          </div>
        </div>
      </div>

      <div style={{ width: 214, background: "#10161f", borderLeft: "1px solid #1b2a3a", overflowY: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #1b2a3a", fontSize: 13, fontWeight: 700, letterSpacing: 1.2, color: "#f4f8ff" }}>INSPECTOR</div>
        <div style={{ padding: 14, fontSize: 11, color: "#9fb2c6", lineHeight: 1.55 }}>
          <div style={{ color: "#28d8ff", fontWeight: 800, marginBottom: 6 }}>ACTIVE</div>
          <div style={{ border: "1px solid #243447", background: "#0d1219", borderRadius: 6, padding: 10, marginBottom: 14, color: "#eef6ff" }}>{activePanelScene === "MAP" ? "World / Map" : SCENES.find((scene) => scene.id === activePanelScene)?.label ?? activePanelScene}</div>

          <div style={{ color: "#28d8ff", fontWeight: 800, marginBottom: 6 }}>HOOK UPGRADE</div>
          <div style={{ marginBottom: 14 }}>
            Skyline → Street → Germany Map → Rings → Data Cards.
          </div>

          <div style={{ color: "#28d8ff", fontWeight: 800, marginBottom: 6 }}>IMPORTED MODELS</div>
          <div>• House OBJ</div>
          <div>• Pine Tree OBJ</div>
          <div>• Water Bottle OBJ</div>
          <div>• Radio OBJ</div>
          <div style={{ marginBottom: 14 }}>• Bulletin Board OBJ</div>

          <div style={{ color: "#28d8ff", fontWeight: 800, marginBottom: 6 }}>SCENARIO DATA</div>
          <div><span style={{ color: "#627a95" }}>Detonation:</span> 15 kt · Luftdetonation</div>
          <div><span style={{ color: "#627a95" }}>Feuerball:</span> ca. 180 m</div>
          <div><span style={{ color: "#627a95" }}>5 psi:</span> ca. 1,6 km</div>
          <div><span style={{ color: "#627a95" }}>1 psi:</span> ca. 4,5 km</div>
          <div><span style={{ color: "#627a95" }}>Thermisch:</span> ca. 1,5–2,5 km</div>
          <div style={{ marginBottom: 14 }}><span style={{ color: "#627a95" }}>Quellen:</span> NUKEMAP · BBK · FEMA</div>

          <div style={{ color: "#28d8ff", fontWeight: 800, marginBottom: 6 }}>BBK CHECKLISTE</div>
          <div>✓ 10 Tage Vorrat</div>
          <div>✓ 2 Liter Wasser / Tag</div>
          <div>✓ Radio · Taschenlampe</div>
          <div>✓ Dokumentenmappe</div>
          <div>✓ Bargeld</div>
          <div>✓ NINA-App</div>
        </div>
      </div>
    </div>
  );
}
