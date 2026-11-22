import * as THREE from 'three';
import type { MaterialDetails, ShaderKind } from '../types';

/** Duck-typed MToonMaterial fields, so tests can use a plain object instead of the WebGL-bound class. */
interface MToonLike {
  isMToonMaterial?: boolean;
  v0CompatShade?: boolean;
  shadeColorFactor?: THREE.Color;
  outlineWidthMode?: string;
  outlineWidthFactor?: number;
}

const SHADER_LABELS: Record<ShaderKind, string> = {
  mtoon1: 'MToon 1.0', mtoon0: 'MToon 0.x compat', standard: 'PBR Standard', physical: 'PBR Physical', unlit: 'Unlit', other: 'Other'
};

/** MToon is reported as 0.x compat when the model's meta is VRM 0.x (three-vrm converts it) or the material uses v0 shading. */
export function classifyShader(material: THREE.Material, vrmMetaVersion?: string): { shader: ShaderKind; shaderLabel: string } {
  const any = material as THREE.Material & MToonLike & { isMeshPhysicalMaterial?: boolean; isMeshStandardMaterial?: boolean; isMeshBasicMaterial?: boolean };
  const shader: ShaderKind = any.isMToonMaterial ? (vrmMetaVersion === '0' || any.v0CompatShade ? 'mtoon0' : 'mtoon1')
    : any.isMeshPhysicalMaterial ? 'physical' : any.isMeshStandardMaterial ? 'standard' : any.isMeshBasicMaterial ? 'unlit' : 'other';
  return { shader, shaderLabel: shader === 'other' ? `Other (${material.type})` : SHADER_LABELS[shader] };
}

/** glTF alpha mode as GLTFLoader maps it: transparent → BLEND, alphaTest > 0 → MASK, else OPAQUE. */
export function classifyAlpha(material: THREE.Material): { alphaMode: MaterialDetails['alphaMode']; alphaCutoff?: number } {
  if (material.transparent) return { alphaMode: 'BLEND' };
  if (material.alphaTest > 0) return { alphaMode: 'MASK', alphaCutoff: material.alphaTest };
  return { alphaMode: 'OPAQUE' };
}

/**
 * Lists every non-null texture property as [slot, texture]. Reads own properties and prototype getters
 * (MToon exposes its maps as accessors over uniforms), without invoking setters or mutating the material.
 */
export function listTextureSlots(material: THREE.Material): [slot: string, texture: THREE.Texture][] {
  const keys = new Set<string>(Object.keys(material));
  for (let proto = Object.getPrototypeOf(material); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) if (descriptor.get) keys.add(key);
  }
  const seen = new Set<string>(), out: [string, THREE.Texture][] = [];
  for (const key of keys) {
    if (key.startsWith('_') || key === 'uniforms') continue;
    let value: unknown;
    try { value = (material as unknown as Record<string, unknown>)[key]; } catch { continue; }
    if (value instanceof THREE.Texture && !seen.has(key)) { seen.add(key); out.push([key, value]); }
  }
  return out.sort((a, b) => slotOrder(a[0]) - slotOrder(b[0]) || a[0].localeCompare(b[0]));
}

const SLOT_ORDER = ['map', 'normalMap', 'emissiveMap', 'shadeMultiplyTexture', 'shadingShiftTexture', 'matcapTexture', 'rimMultiplyTexture', 'outlineWidthMultiplyTexture', 'uvAnimationMaskTexture', 'metalnessMap', 'roughnessMap', 'aoMap', 'alphaMap'];
const slotOrder = (slot: string) => { const index = SLOT_ORDER.indexOf(slot); return index < 0 ? SLOT_ORDER.length : index; };

/** Pixel size of a texture's image, or 0×0 when it has no measurable image. */
export function textureSize(texture: THREE.Texture) {
  const image = texture.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | null | undefined;
  return { width: image?.videoWidth || image?.width || 0, height: image?.videoHeight || image?.height || 0 };
}

const hex = (color: THREE.Color | undefined) => color instanceof THREE.Color ? `#${color.getHexString()}` : undefined;

/** Describes a material without touching its state. Thumbnails are filled in by the caller. */
export function describeMaterialInfo(material: THREE.Material, meshCount: number, vrmMetaVersion?: string): MaterialDetails {
  const any = material as THREE.Material & MToonLike & { color?: THREE.Color };
  const { shader, shaderLabel } = classifyShader(material, vrmMetaVersion);
  const mtoon = shader === 'mtoon0' || shader === 'mtoon1';
  return {
    uuid: material.uuid, name: material.name || 'Unnamed material', type: material.type, shader, shaderLabel,
    ...classifyAlpha(material), doubleSided: material.side === THREE.DoubleSide, baseColor: hex(any.color),
    shadeColor: mtoon ? hex(any.shadeColorFactor) : undefined,
    outlineWidthMode: mtoon && typeof any.outlineWidthMode === 'string' ? any.outlineWidthMode : undefined,
    outlineWidthFactor: mtoon && typeof any.outlineWidthFactor === 'number' ? any.outlineWidthFactor : undefined,
    textures: listTextureSlots(material).map(([slot, texture]) => ({ slot, uuid: texture.uuid, name: texture.name, ...textureSize(texture) })),
    meshCount
  };
}
