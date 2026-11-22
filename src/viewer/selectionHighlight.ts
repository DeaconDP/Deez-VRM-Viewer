import * as THREE from 'three';
import type { TreeItem } from '../types';

export type SelectionRef = { id: string; kind: TreeItem['kind'] };

/** Matches `--accent` in styles.css. */
export const SELECTION_COLOR = 0xf29343;
/** Material selections outline at most this many meshes. */
export const MAX_MATERIAL_TARGETS = 64;
/** Vertex samples per highlight refresh, shared across targets; exact bounds are used when framing. */
export const LIVE_SAMPLE_BUDGET = 24000;

const OVERLAY_ORDER = 999;
const _vertex = new THREE.Vector3();
const _point = new THREE.Vector3();

type GeometryObject = THREE.Object3D & { geometry?: THREE.BufferGeometry; isMesh?: boolean; isInstancedMesh?: boolean; material?: THREE.Material | THREE.Material[] };

const materialsOf = (object: GeometryObject) => Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];

/** Resolves an explorer item to the scene objects it refers to. Expressions, textures and unknown ids resolve to nothing. */
export function resolveSelection(root: THREE.Object3D | null, item: SelectionRef | null): THREE.Object3D[] {
  if (!root || !item) return [];
  if (item.kind === 'material') {
    const meshes: THREE.Object3D[] = [];
    root.traverse(object => {
      const any = object as GeometryObject;
      if (meshes.length < MAX_MATERIAL_TARGETS && any.isMesh && materialsOf(any).some(m => m.uuid === item.id)) meshes.push(object);
    });
    return meshes;
  }
  if (item.kind !== 'node' && item.kind !== 'mesh' && item.kind !== 'bone') return [];
  const object = root.getObjectByProperty('uuid', item.id) as GeometryObject | undefined;
  if (!object) return [];
  if (item.kind === 'mesh' && !object.isMesh) return [];
  if (item.kind === 'bone' && !(object as THREE.Bone).isBone) return [];
  return [object];
}

const vertexCount = (object: GeometryObject) => object.geometry?.getAttribute('position')?.count ?? 0;

/** Total vertex count of geometry under the given objects (used to split a sampling budget). */
export function countVertices(objects: THREE.Object3D[]) {
  let total = 0;
  for (const root of objects) root.traverse(object => { total += vertexCount(object as GeometryObject); });
  return total;
}

/**
 * Expands `box` by the world-space vertices of `object` and its descendants. Mesh vertices go through
 * `Mesh.getVertexPosition`, so morph targets and (for SkinnedMesh) the current bone pose are applied.
 * `stride` > 1 samples every n-th vertex for cheap per-frame refreshes. Matrices must be current.
 */
export function expandByPosedObject(box: THREE.Box3, object: THREE.Object3D, stride = 1) {
  object.traverse(child => {
    const any = child as GeometryObject;
    const position = any.geometry?.getAttribute('position');
    if (!position) return;
    if (any.isInstancedMesh) { box.union(new THREE.Box3().setFromObject(child)); return; }
    const step = Math.max(1, Math.floor(stride));
    for (let i = 0; i < position.count; i += step) {
      if (any.isMesh) (child as THREE.Mesh).getVertexPosition(i, _vertex);
      else _vertex.fromBufferAttribute(position, i);
      box.expandByPoint(_vertex.applyMatrix4(child.matrixWorld));
    }
  });
  return box;
}

/** World positions of the objects and all descendants: bounds for geometry-free selections (armatures, empties). */
export function expandByJoints(box: THREE.Box3, objects: THREE.Object3D[]) {
  for (const root of objects) root.traverse(object => { box.expandByPoint(object.getWorldPosition(_point)); });
  return box;
}

/** Bounds of a bone: its joint and the joints of its direct child bones. */
export function boneBounds(bone: THREE.Object3D, box = new THREE.Box3()) {
  box.makeEmpty().expandByPoint(bone.getWorldPosition(_point));
  for (const child of bone.children) if ((child as THREE.Bone).isBone) box.expandByPoint(child.getWorldPosition(_point));
  return box;
}

/**
 * World bounds of resolved selection targets. Bones use `boneBounds`; anything else uses posed vertex bounds and
 * falls back to joint positions when the subtree has no geometry. `minSize` pads tiny boxes so framing never collapses.
 */
export function selectionBounds(targets: THREE.Object3D[], kind: TreeItem['kind'], box = new THREE.Box3(), minSize = 0, sampleBudget = Infinity) {
  box.makeEmpty();
  const stride = Number.isFinite(sampleBudget) ? Math.max(1, Math.ceil(countVertices(targets) / sampleBudget)) : 1;
  if (kind === 'bone') { for (const target of targets) box.union(boneBounds(target, new THREE.Box3())); }
  else {
    for (const target of targets) expandByPosedObject(box, target, stride);
    if (box.isEmpty()) expandByJoints(box, targets);
  }
  if (!box.isEmpty() && minSize > 0) {
    const size = box.getSize(_point);
    const pad = new THREE.Vector3(Math.max(0, minSize - size.x), Math.max(0, minSize - size.y), Math.max(0, minSize - size.z)).multiplyScalar(0.5);
    box.min.sub(pad); box.max.add(pad);
  }
  return box;
}

type BoxEntry = { helper: THREE.Box3Helper; target: THREE.Object3D };
type BoneMarker = { target: THREE.Object3D; marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; axes: THREE.AxesHelper; link: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null };

const overlay = <T extends THREE.Object3D>(object: T) => {
  object.renderOrder = OVERLAY_ORDER; object.frustumCulled = false;
  const material = (object as unknown as { material: THREE.Material }).material;
  material.depthTest = false; material.depthWrite = false; material.transparent = true; material.toneMapped = false;
  return object;
};

/** Viewport overlay for the explorer selection. Owns every helper it creates; the model itself is never touched. */
export class SelectionHighlight {
  readonly group = new THREE.Group();
  private root: THREE.Object3D | null = null;
  private item: SelectionRef | null = null;
  private targets: THREE.Object3D[] = [];
  private boxes: BoxEntry[] = [];
  private bone: BoneMarker | null = null;
  private modelSize = 1;
  private _bounds = new THREE.Box3();

  constructor() { this.group.name = 'SelectionHighlight'; }

  /** Number of objects currently highlighted (0 when nothing resolved). */
  get count() { return this.targets.length; }
  get kind() { return this.targets.length ? this.item?.kind ?? null : null; }
  matches(root: THREE.Object3D | null, item: SelectionRef | null) { return root === this.root && item?.id === this.item?.id && item?.kind === this.item?.kind; }

  /** Replaces the highlight. Returns the number of highlighted objects. */
  set(root: THREE.Object3D | null, item: SelectionRef | null) {
    this.clear();
    this.root = root; this.item = item;
    this.targets = resolveSelection(root, item);
    if (!root || !this.targets.length) return 0;
    root.updateMatrixWorld(true);
    const modelBox = new THREE.Box3().setFromObject(root);
    this.modelSize = modelBox.isEmpty() ? 1 : Math.max(...modelBox.getSize(_point).toArray()) || 1;
    if (item!.kind === 'bone') this.bone = this.createBoneMarker(this.targets[0]);
    else for (const target of this.targets) {
      const helper = overlay(new THREE.Box3Helper(new THREE.Box3(), SELECTION_COLOR));
      (helper.material as THREE.LineBasicMaterial).opacity = 0.95;
      this.boxes.push({ helper, target });
      this.group.add(helper);
    }
    this.refresh(Infinity);
    return this.targets.length;
  }

  private createBoneMarker(target: THREE.Object3D): BoneMarker {
    const marker = overlay(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: SELECTION_COLOR })));
    marker.material.opacity = 0.9;
    const axes = overlay(new THREE.AxesHelper(1));
    const parent = target.parent && (target.parent as THREE.Bone).isBone ? target.parent : null;
    let link: BoneMarker['link'] = null;
    if (parent) {
      link = overlay(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: SELECTION_COLOR })));
      link.material.opacity = 0.7;
      this.group.add(link);
    }
    this.group.add(marker, axes);
    return { target, marker, axes, link };
  }

  /** Re-fits helpers to the current pose. Call before every render. */
  update() { if (this.targets.length) this.refresh(LIVE_SAMPLE_BUDGET); }

  private refresh(sampleBudget: number) {
    this.root?.updateMatrixWorld(true);
    if (this.bone) {
      const { target, marker, axes, link } = this.bone;
      const radius = this.modelSize * 0.012;
      target.getWorldPosition(marker.position); marker.scale.setScalar(radius);
      axes.position.copy(marker.position); target.getWorldQuaternion(axes.quaternion); axes.scale.setScalar(radius * 4);
      if (link && target.parent) {
        const positions = link.geometry.getAttribute('position') as THREE.BufferAttribute;
        target.parent.getWorldPosition(_point); positions.setXYZ(0, _point.x, _point.y, _point.z);
        positions.setXYZ(1, marker.position.x, marker.position.y, marker.position.z); positions.needsUpdate = true;
      }
      return;
    }
    const perTarget = sampleBudget / Math.max(1, this.boxes.length);
    for (const { helper, target } of this.boxes) {
      selectionBounds([target], this.item!.kind, helper.box, this.modelSize * 0.01, perTarget);
      helper.visible = !helper.box.isEmpty();
    }
  }

  /** Exact world bounds of the whole selection (for framing), or null when nothing is highlighted. */
  bounds(target = this._bounds) {
    if (!this.root || !this.targets.length) return null;
    this.root.updateMatrixWorld(true);
    const box = selectionBounds(this.targets, this.item!.kind, target, this.modelSize * (this.item!.kind === 'bone' ? 0.1 : 0.02));
    return box.isEmpty() ? null : box;
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const disposable = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material };
      disposable.geometry?.dispose(); disposable.material?.dispose();
    }
    this.boxes = []; this.bone = null; this.targets = []; this.root = null; this.item = null;
  }

  dispose() { this.clear(); this.group.removeFromParent(); }
}
