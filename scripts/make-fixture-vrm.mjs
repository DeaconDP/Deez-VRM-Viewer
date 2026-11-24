#!/usr/bin/env node
// Writes e2e/fixtures/minimal.vrm: a tiny, licence-clean VRM 1.0 avatar made entirely by this script.
//
// It is a low-poly box figure in T-pose, rigidly skinned to a full VRM 1.0 humanoid (every required bone plus
// chest, neck and shoulders), with one "happy" expression (a morph target on the head), a three-joint hair spring
// bone with a head collider, and VRMC_vrm meta. No third-party geometry or textures are used.
//
// Usage: node scripts/make-fixture-vrm.mjs [output path]
// The output is deterministic, so re-running it leaves the committed fixture unchanged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? `${root}/e2e/fixtures/minimal.vrm`);

// Bones: [name, parent, world position]. VRM 1.0 faces +Z, so the avatar's left side is +X.
const BONES = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 1.05, 0]],
  ['chest', 'spine', [0, 1.2, 0]],
  ['neck', 'chest', [0, 1.4, 0]],
  ['head', 'neck', [0, 1.48, 0]],
  ['leftShoulder', 'chest', [0.06, 1.36, 0]],
  ['leftUpperArm', 'leftShoulder', [0.2, 1.36, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.45, 1.36, 0]],
  ['leftHand', 'leftLowerArm', [0.68, 1.36, 0]],
  ['rightShoulder', 'chest', [-0.06, 1.36, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.2, 1.36, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.45, 1.36, 0]],
  ['rightHand', 'rightLowerArm', [-0.68, 1.36, 0]],
  ['leftUpperLeg', 'hips', [0.1, 0.9, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0.1, 0.5, 0]],
  ['leftFoot', 'leftLowerLeg', [0.1, 0.08, 0]],
  ['rightUpperLeg', 'hips', [-0.1, 0.9, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [-0.1, 0.5, 0]],
  ['rightFoot', 'rightLowerLeg', [-0.1, 0.08, 0]],
  // Not humanoid bones: a short hair strand hanging behind the head, driven by the spring bone.
  ['hairRoot', 'head', [0, 1.7, -0.13]],
  ['hair1', 'hairRoot', [0, 1.6, -0.15]],
  ['hairTip', 'hair1', [0, 1.5, -0.16]]
];
const HUMANOID = BONES.filter(([name]) => !name.startsWith('hair')).map(([name]) => name);

const SKIN = [235, 196, 170], SHIRT = [64, 132, 196], TROUSERS = [52, 58, 74], SHOES = [30, 30, 34], HAIR = [120, 72, 40];
// Boxes: [bone, centre, size, colour]; each box is skinned 100% to its bone.
const BODY_BOXES = [
  ['hips', [0, 0.95, 0], [0.3, 0.14, 0.18], TROUSERS],
  ['spine', [0, 1.12, 0], [0.3, 0.2, 0.17], SHIRT],
  ['chest', [0, 1.29, 0], [0.36, 0.2, 0.2], SHIRT],
  ['neck', [0, 1.44, 0], [0.08, 0.08, 0.08], SKIN],
  ...['left', 'right'].flatMap(side => {
    const s = side === 'left' ? 1 : -1;
    return [
      [`${side}UpperArm`, [s * 0.325, 1.36, 0], [0.25, 0.08, 0.08], SHIRT],
      [`${side}LowerArm`, [s * 0.565, 1.36, 0], [0.23, 0.07, 0.07], SKIN],
      [`${side}Hand`, [s * 0.73, 1.36, 0], [0.1, 0.04, 0.08], SKIN],
      [`${side}UpperLeg`, [s * 0.1, 0.7, 0], [0.12, 0.4, 0.12], TROUSERS],
      [`${side}LowerLeg`, [s * 0.1, 0.29, 0], [0.1, 0.42, 0.1], TROUSERS],
      [`${side}Foot`, [s * 0.1, 0.04, 0.04], [0.1, 0.08, 0.22], SHOES]
    ];
  }),
  ['hair1', [0, 1.58, -0.15], [0.16, 0.24, 0.03], HAIR]
];
const FACE_BOXES = [['head', [0, 1.6, 0], [0.22, 0.24, 0.22], SKIN]];

const boneIndex = name => {
  const index = BONES.findIndex(([bone]) => bone === name);
  if (index < 0) throw new Error(`Unknown bone ${name}`);
  return index;
};

// Box faces: normal, then the four corners (as -1/+1 signs per axis) in counter-clockwise order seen from outside.
const FACES = [
  [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
];

// glTF vertex colours are linear; the palette above is written in sRGB.
const toLinear = value => { const c = value / 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };

function buildGeometry(boxes) {
  const positions = [], normals = [], colors = [], joints = [], weights = [], indices = [];
  for (const [bone, centre, size, colour] of boxes) {
    const joint = boneIndex(bone);
    for (const [normal, corners] of FACES) {
      const base = positions.length / 3;
      for (const corner of corners) {
        positions.push(...corner.map((sign, axis) => centre[axis] + sign * size[axis] / 2));
        normals.push(...normal);
        colors.push(...colour.map(toLinear), 255);
        joints.push(joint, 0, 0, 0);
        weights.push(1, 0, 0, 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions, normals, colors, joints, weights, indices };
}

// --- Binary buffer and accessors ---
const chunks = [];
let byteLength = 0;
const bufferViews = [], accessors = [];
function addView(bytes, target) {
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) { chunks.push(new Uint8Array(padding)); byteLength += padding; }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
  chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  byteLength += bytes.byteLength;
  return bufferViews.length - 1;
}
function addAccessor(values, { type, componentType, normalized, target, minMax }) {
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
  const Array_ = { 5121: Uint8Array, 5123: Uint16Array, 5126: Float32Array }[componentType];
  const view = addView(Array_.from(values), target);
  const accessor = { bufferView: view, componentType, count: values.length / size, type, ...(normalized ? { normalized: true } : {}) };
  if (minMax) {
    accessor.min = Array.from({ length: size }, (_, axis) => Math.min(...values.filter((_, n) => n % size === axis)));
    accessor.max = Array.from({ length: size }, (_, axis) => Math.max(...values.filter((_, n) => n % size === axis)));
  }
  accessors.push(accessor);
  return accessors.length - 1;
}
const round = values => values.map(value => Math.round(value * 1e5) / 1e5);

function addPrimitive(boxes, morph) {
  const g = buildGeometry(boxes);
  const attributes = {
    POSITION: addAccessor(round(g.positions), { type: 'VEC3', componentType: 5126, target: 34962, minMax: true }),
    NORMAL: addAccessor(g.normals, { type: 'VEC3', componentType: 5126, target: 34962 }),
    COLOR_0: addAccessor(g.colors, { type: 'VEC4', componentType: 5121, normalized: true, target: 34962 }),
    JOINTS_0: addAccessor(g.joints, { type: 'VEC4', componentType: 5121, target: 34962 }),
    WEIGHTS_0: addAccessor(g.weights, { type: 'VEC4', componentType: 5126, target: 34962 })
  };
  const primitive = { attributes, indices: addAccessor(g.indices, { type: 'SCALAR', componentType: 5123, target: 34963 }), material: 0, mode: 4 };
  if (morph) primitive.targets = [{ POSITION: addAccessor(round(morph(g.positions)), { type: 'VEC3', componentType: 5126, target: 34962, minMax: true }) }];
  return primitive;
}

// "happy": the head grows 15% wider and a little taller (positions are deltas from the base shape).
const happyDeltas = positions => positions.map((value, n) => {
  const axis = n % 3, centre = FACE_BOXES[0][1][axis];
  return axis === 0 ? (value - centre) * 0.15 : axis === 1 ? (value - centre) * 0.08 : 0;
});

const bodyPrimitive = addPrimitive(BODY_BOXES);
const facePrimitive = addPrimitive(FACE_BOXES, happyDeltas);

// Joint world matrices are pure translations, so each inverse bind matrix is the negated translation.
const inverseBind = BONES.flatMap(([, , [x, y, z]]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);
const inverseBindAccessor = addAccessor(inverseBind, { type: 'MAT4', componentType: 5126 });

// --- Nodes: bones first (index = bone index), then the two meshes ---
const nodes = BONES.map(([name, parent, world]) => {
  const parentWorld = parent ? BONES[boneIndex(parent)][2] : [0, 0, 0];
  const node = { name, translation: world.map((value, axis) => Math.round((value - parentWorld[axis]) * 1e5) / 1e5) };
  const children = BONES.flatMap(([child, childParent], index) => childParent === name ? [index] : []);
  if (children.length) node.children = children;
  return node;
});
const bodyNode = nodes.push({ name: 'Body', mesh: 0, skin: 0 }) - 1;
const faceNode = nodes.push({ name: 'Face', mesh: 1, skin: 0 }) - 1;
const node = name => boneIndex(name);

const humanBones = Object.fromEntries(HUMANOID.map(name => [name, { node: node(name) }]));

const gltf = {
  asset: { version: '2.0', generator: 'Deez VRM Viewer scripts/make-fixture-vrm.mjs', copyright: 'deac online · Worldbuild.io (MIT)' },
  extensionsUsed: ['VRMC_vrm', 'VRMC_springBone'],
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [node('hips'), bodyNode, faceNode] }],
  nodes,
  meshes: [
    { name: 'Body', primitives: [bodyPrimitive] },
    { name: 'Face', primitives: [facePrimitive], weights: [0], extras: { targetNames: ['happy'] } }
  ],
  skins: [{ name: 'Armature', joints: BONES.map((_, index) => index), inverseBindMatrices: inverseBindAccessor, skeleton: node('hips') }],
  materials: [{ name: 'Fixture', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: 0 }],
  extensions: {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: 'Deez fixture',
        version: '1.0',
        authors: ['deac online · Worldbuild.io'],
        copyrightInformation: 'Generated by scripts/make-fixture-vrm.mjs in Deez VRM Viewer. MIT licence.',
        contactInformation: 'https://worldbuild.io/',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        avatarPermission: 'everyone',
        allowExcessivelyViolentUsage: true,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation',
        allowPoliticalOrReligiousUsage: true,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'unnecessary',
        allowRedistribution: true,
        modification: 'allowModificationRedistribution',
        otherLicenseUrl: 'https://opensource.org/license/mit'
      },
      humanoid: { humanBones },
      expressions: {
        preset: {
          happy: { morphTargetBinds: [{ node: faceNode, index: 0, weight: 1 }], isBinary: false, overrideBlink: 'none', overrideLookAt: 'none', overrideMouth: 'none' }
        }
      }
    },
    VRMC_springBone: {
      specVersion: '1.0',
      colliders: [{ node: node('head'), shape: { sphere: { offset: [0, 0.12, 0], radius: 0.12 } } }],
      colliderGroups: [{ name: 'Head', colliders: [0] }],
      springs: [{
        name: 'Hair',
        joints: [
          { node: node('hairRoot'), hitRadius: 0.02, stiffness: 1, gravityPower: 0.5, gravityDir: [0, -1, 0], dragForce: 0.4 },
          { node: node('hair1'), hitRadius: 0.02, stiffness: 1, gravityPower: 0.5, gravityDir: [0, -1, 0], dragForce: 0.4 },
          { node: node('hairTip'), hitRadius: 0.02 }
        ],
        colliderGroups: [0]
      }]
    }
  }
};

// --- GLB container ---
const bin = new Uint8Array(Math.ceil(byteLength / 4) * 4);
let offset = 0;
for (const chunk of chunks) { bin.set(chunk, offset); offset += chunk.byteLength; }
gltf.buffers[0].byteLength = bin.byteLength;
const jsonText = JSON.stringify(gltf);
const jsonBytes = new TextEncoder().encode(jsonText + ' '.repeat((4 - (Buffer.byteLength(jsonText) % 4)) % 4));
const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
const glb = new Uint8Array(total);
const header = new DataView(glb.buffer);
header.setUint32(0, 0x46546c67, true); // "glTF"
header.setUint32(4, 2, true);
header.setUint32(8, total, true);
header.setUint32(12, jsonBytes.byteLength, true);
header.setUint32(16, 0x4e4f534a, true); // "JSON"
glb.set(jsonBytes, 20);
const binStart = 20 + jsonBytes.byteLength;
header.setUint32(binStart, bin.byteLength, true);
header.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
glb.set(bin, binStart + 8);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, glb);
console.log(`Wrote ${output} (${glb.byteLength} bytes, ${BONES.length} bones, ${HUMANOID.length} humanoid)`);
