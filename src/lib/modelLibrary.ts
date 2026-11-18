import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export type ModelKey = "house" | "tree" | "bottle" | "radio" | "board";
export type ModelLibrary = Record<ModelKey, THREE.Group>;

const MODEL_URLS: Record<ModelKey, string> = {
  house: "/models/house_tall.obj",
  tree: "/models/pine_tree.obj",
  bottle: "/models/water_bottle.obj",
  radio: "/models/radio.obj",
  board: "/models/bulletin_board.obj",
};

function standard(color: number, roughness = 0.9, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    flatShading: true,
  });
}

function normalizeModel(root: THREE.Group, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const safeHeight = Math.max(0.001, size.y);
  const scale = targetHeight / safeHeight;
  root.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(root);
  const center2 = new THREE.Vector3();
  const size2 = new THREE.Vector3();
  box2.getCenter(center2);
  box2.getSize(size2);

  root.position.x -= center2.x;
  root.position.z -= center2.z;
  root.position.y -= box2.min.y;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.geometry && !mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals();
      }
    }
  });

  return root;
}

function paintImportedModel(root: THREE.Group, key: ModelKey) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = child.name.toLowerCase();

    if (key === "house") {
      if (name.includes("roof")) mesh.material = standard(0xff8c69, 0.88);
      else if (name.includes("door")) mesh.material = standard(0x2b2b33, 0.92);
      else if (name.includes("frame")) mesh.material = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x234a78, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.05, flatShading: true });
      else mesh.material = standard(0x6f8fca, 0.92);
      return;
    }

    if (key === "tree") {
      if (name.includes("trunk")) mesh.material = standard(0x7a5a30, 0.96);
      else if (name.includes("top")) mesh.material = standard(0x2f8f48, 0.98);
      else if (name.includes("mid")) mesh.material = standard(0x3da357, 0.98);
      else mesh.material = standard(0x2c7d46, 0.98);
      return;
    }

    if (key === "bottle") {
      if (name.includes("cap")) mesh.material = standard(0xffffff, 0.4, 0.05);
      else if (name.includes("neck")) mesh.material = new THREE.MeshStandardMaterial({ color: 0x89d4ff, emissive: 0x0f3154, emissiveIntensity: 0.15, transparent: true, opacity: 0.9, roughness: 0.18, metalness: 0.04, flatShading: true });
      else mesh.material = new THREE.MeshStandardMaterial({ color: 0x65b8ff, emissive: 0x143c66, emissiveIntensity: 0.18, transparent: true, opacity: 0.86, roughness: 0.16, metalness: 0.04, flatShading: true });
      return;
    }

    if (key === "radio") {
      if (name.includes("speaker")) mesh.material = standard(0x111111, 0.85);
      else if (name.includes("dial")) mesh.material = standard(0xffd26f, 0.5);
      else if (name.includes("antenna")) mesh.material = standard(0xb8c5d1, 0.35, 0.55);
      else mesh.material = standard(0x394048, 0.82);
      return;
    }

    if (key === "board") {
      if (name.includes("paper")) mesh.material = standard(0xf2f0dd, 0.75);
      else if (name.includes("leg")) mesh.material = standard(0x5b4329, 0.95);
      else mesh.material = standard(0x934f31, 0.92);
    }
  });

  return root;
}

function fallbackHouse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.85), standard(0x6f8fca));
  body.position.y = 0.7;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.55, 4), standard(0xff8c69));
  roof.position.y = 1.7;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}

function fallbackTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.55, 5), standard(0x7a5a30));
  trunk.position.y = 0.28;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.25, 6), standard(0x2c7d46));
  leaves.position.y = 1.0;
  g.add(leaves);
  return g;
}

function fallbackBottle() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x65b8ff, transparent: true, opacity: 0.86, roughness: 0.15, flatShading: true }));
  body.position.y = 0.28;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), standard(0xffffff, 0.4));
  cap.position.y = 0.62;
  g.add(cap);
  return g;
}

function fallbackRadio() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.34, 0.3), standard(0x394048));
  body.position.y = 0.17;
  g.add(body);
  return g;
}

function fallbackBoard() {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.14), standard(0x934f31));
  board.position.y = 1.45;
  g.add(board);
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), standard(0x5b4329));
  l.position.set(-0.45, 0.48, 0);
  g.add(l);
  const r = l.clone();
  r.position.x = 0.45;
  g.add(r);
  return g;
}

const FALLBACKS: Record<ModelKey, () => THREE.Group> = {
  house: fallbackHouse,
  tree: fallbackTree,
  bottle: fallbackBottle,
  radio: fallbackRadio,
  board: fallbackBoard,
};

const TARGET_HEIGHT: Record<ModelKey, number> = {
  house: 2.1,
  tree: 2.1,
  bottle: 0.9,
  radio: 0.5,
  board: 2.1,
};

async function loadOne(loader: OBJLoader, key: ModelKey) {
  try {
    const obj = await loader.loadAsync(MODEL_URLS[key]);
    const root = new THREE.Group();
    root.name = `model_${key}`;
    root.add(obj);
    normalizeModel(root, TARGET_HEIGHT[key]);
    paintImportedModel(root, key);
    return root;
  } catch {
    const fallback = FALLBACKS[key]();
    fallback.name = `model_${key}_fallback`;
    normalizeModel(fallback, TARGET_HEIGHT[key]);
    return fallback;
  }
}

export async function loadModelLibrary(): Promise<ModelLibrary> {
  const loader = new OBJLoader();
  const [house, tree, bottle, radio, board] = await Promise.all([
    loadOne(loader, "house"),
    loadOne(loader, "tree"),
    loadOne(loader, "bottle"),
    loadOne(loader, "radio"),
    loadOne(loader, "board"),
  ]);

  return { house, tree, bottle, radio, board };
}

export function cloneModel<T extends THREE.Object3D>(source: T): T {
  const clone = source.clone(true) as T;
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}
