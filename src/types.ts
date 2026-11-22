export type LoadState = 'idle' | 'reading' | 'parsing' | 'ready' | 'error';

export type AnimationLoopMode = 'repeat' | 'once' | 'pingpong';

export interface AnimationState {
  name: string;
  source: 'built-in' | 'file' | null;
  duration: number;
  time: number;
  playing: boolean;
  loading: boolean;
  error: string;
}

export interface TreeItem {
  id: string;
  label: string;
  kind: 'node' | 'mesh' | 'material' | 'texture' | 'bone' | 'system';
  detail?: string;
}

export interface ModelSummary {
  name: string;
  format: 'VRM' | 'glTF';
  version: string;
  generator: string;
  size: number;
  loadMs: number;
  nodes: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  bones: number;
  expressions: string[];
  authors: string[];
  license: string;
  /** Full VRM licence and permission metadata, grouped for display. Null for glTF models. */
  licence: LicenceInfo | null;
  items: TreeItem[];
  /** Detached clothing/hair skeletons that could not be pose-synced. */
  unsyncedDetachedSkeletons?: number;
}

export interface MetaValue { text: string; /** Only set for http(s) URLs. */ href?: string }
export interface MetaRow { key: string; label: string; values: MetaValue[] }
export interface MetaGroup { id: 'identity' | 'permissions' | 'redistribution'; title: string; rows: MetaRow[] }
export interface LicenceInfo { metaVersion: '0' | '1'; groups: MetaGroup[] }

export type ShaderKind = 'mtoon1' | 'mtoon0' | 'standard' | 'physical' | 'unlit' | 'other';

export interface MaterialTexture {
  slot: string;
  uuid: string;
  name: string;
  width: number;
  height: number;
  /** Small PNG data URL, absent when the image cannot be drawn. */
  thumbnail?: string;
}

export interface MaterialDetails {
  uuid: string;
  name: string;
  type: string;
  shader: ShaderKind;
  shaderLabel: string;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided: boolean;
  baseColor?: string;
  shadeColor?: string;
  outlineWidthMode?: string;
  outlineWidthFactor?: number;
  textures: MaterialTexture[];
  meshCount: number;
}
