import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_MATERIAL_TARGETS, SelectionHighlight, boneBounds, resolveSelection, selectionBounds } from './selectionHighlight';

const box = (size = 1, material = new THREE.MeshBasicMaterial()) => new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);

function scene() {
  const root = new THREE.Group(), shared = new THREE.MeshBasicMaterial(), other = new THREE.MeshBasicMaterial();
  const node = new THREE.Group(); node.position.set(10, 0, 0);
  const a = box(2, shared), b = box(2, shared), c = box(2, other);
  a.position.set(0, 1, 0); b.position.set(0, -1, 0); c.position.set(5, 0, 0);
  node.add(a, b); root.add(node, c);
  const multi = new THREE.Mesh(new THREE.BoxGeometry(), [other, shared]); multi.position.set(-5, 0, 0); root.add(multi);
  root.updateMatrixWorld(true);
  return { root, node, a, b, c, multi, shared, other };
}

function skinned() {
  const geometry = new THREE.BoxGeometry(1, 2, 1, 1, 4, 1);
  const position = geometry.getAttribute('position'), skinIndex: number[] = [], skinWeight: number[] = [];
  for (let i = 0; i < position.count; i++) { const upper = position.getY(i) > 0; skinIndex.push(upper ? 1 : 0, 0, 0, 0); skinWeight.push(1, 0, 0, 0); }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const hips = new THREE.Bone(), chest = new THREE.Bone(), head = new THREE.Bone();
  hips.name = 'hips'; chest.name = 'chest'; head.name = 'head';
  chest.position.y = 0.5; head.position.y = 0.6; hips.add(chest); chest.add(head);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group(); root.add(hips, mesh); root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hips, chest]));
  return { root, mesh, hips, chest, head };
}

describe('resolveSelection', () => {
  it('finds nodes, meshes and bones by uuid', () => {
    const { root, node, a } = scene(), { root: rig, chest } = skinned();
    expect(resolveSelection(root, { id: node.uuid, kind: 'node' })).toEqual([node]);
    expect(resolveSelection(root, { id: a.uuid, kind: 'mesh' })).toEqual([a]);
    expect(resolveSelection(rig, { id: chest.uuid, kind: 'bone' })).toEqual([chest]);
  });
  it('finds every mesh using a material, including multi-material meshes', () => {
    const { root, a, b, multi, c, shared, other } = scene();
    expect(resolveSelection(root, { id: shared.uuid, kind: 'material' })).toEqual([a, b, multi]);
    expect(resolveSelection(root, { id: other.uuid, kind: 'material' })).toEqual([c, multi]);
  });
  it('caps material targets', () => {
    const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
    for (let i = 0; i < MAX_MATERIAL_TARGETS + 10; i++) root.add(box(1, material));
    expect(resolveSelection(root, { id: material.uuid, kind: 'material' })).toHaveLength(MAX_MATERIAL_TARGETS);
  });
  it('returns nothing for unknown ids, expressions, mismatched kinds and missing roots', () => {
    const { root, node, a } = scene();
    expect(resolveSelection(root, { id: 'nope', kind: 'mesh' })).toEqual([]);
    expect(resolveSelection(root, { id: 'expression-0', kind: 'system' })).toEqual([]);
    expect(resolveSelection(root, { id: a.uuid, kind: 'system' })).toEqual([]);
    expect(resolveSelection(root, { id: node.uuid, kind: 'mesh' })).toEqual([]);
    expect(resolveSelection(root, { id: a.uuid, kind: 'bone' })).toEqual([]);
    expect(resolveSelection(null, { id: a.uuid, kind: 'mesh' })).toEqual([]);
    expect(resolveSelection(root, null)).toEqual([]);
  });
});

describe('selectionBounds', () => {
  it('uses world bounds for a mesh', () => {
    const { a } = scene(), bounds = selectionBounds([a], 'mesh');
    expect(bounds.min.toArray()).toEqual([9, 0, -1]);
    expect(bounds.max.toArray()).toEqual([11, 2, 1]);
  });
  it('covers a node subtree', () => {
    const { node } = scene(), bounds = selectionBounds([node], 'node');
    expect(bounds.min.toArray()).toEqual([9, -2, -1]);
    expect(bounds.max.toArray()).toEqual([11, 2, 1]);
  });
  it('covers every mesh of a material set', () => {
    const { a, b, multi } = scene(), bounds = selectionBounds([a, b, multi], 'material');
    expect(bounds.min.toArray()).toEqual([-5.5, -2, -1]);
    expect(bounds.max.toArray()).toEqual([11, 2, 1]);
  });
  it('follows the skinned pose rather than the bind pose', () => {
    const { root, mesh, chest } = skinned();
    expect(selectionBounds([mesh], 'mesh').max.x).toBeCloseTo(0.5);
    chest.position.x = 3; root.updateMatrixWorld(true);
    const posed = selectionBounds([mesh], 'mesh');
    expect(posed.max.x).toBeCloseTo(3.5);
    expect(posed.min.x).toBeCloseTo(-0.5);
  });
  it('samples within a vertex budget without growing past the exact box', () => {
    const { mesh } = skinned(), exact = selectionBounds([mesh], 'mesh'), sampled = selectionBounds([mesh], 'mesh', undefined, 0, 4);
    expect(sampled.isEmpty()).toBe(false);
    expect(exact.containsBox(sampled)).toBe(true);
  });
  it('falls back to joint positions for geometry-free nodes', () => {
    const { hips } = skinned(), bounds = selectionBounds([hips], 'node');
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.1);
  });
  it('bounds a bone by its joint and child joints, padded to a minimum size', () => {
    const { chest } = skinned();
    const raw = boneBounds(chest);
    expect(raw.min.y).toBeCloseTo(0.5); expect(raw.max.y).toBeCloseTo(1.1);
    const padded = selectionBounds([chest], 'bone', undefined, 1);
    expect(padded.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(5))).toEqual([1, 1, 1]);
  });
  it('is empty for no targets', () => {
    expect(selectionBounds([], 'mesh').isEmpty()).toBe(true);
  });
});

describe('SelectionHighlight', () => {
  it('adds helpers to its own group, leaves the model untouched and disposes on clear', () => {
    const { root, a, shared } = scene(), childCount = root.children.length, highlight = new SelectionHighlight();
    expect(highlight.set(root, { id: shared.uuid, kind: 'material' })).toBe(3);
    expect(highlight.group.children).toHaveLength(3);
    expect(highlight.kind).toBe('material');
    expect(root.children).toHaveLength(childCount);
    const helper = highlight.group.children[0] as THREE.Box3Helper;
    let disposed = 0; helper.geometry.addEventListener('dispose', () => disposed++); (helper.material as THREE.Material).addEventListener('dispose', () => disposed++);
    expect(highlight.set(root, { id: a.uuid, kind: 'mesh' })).toBe(1);
    expect(disposed).toBe(2);
    expect(highlight.group.children).toHaveLength(1);
    highlight.clear();
    expect(highlight.group.children).toHaveLength(0);
    expect(highlight.kind).toBeNull();
  });
  it('keeps the outline on the object while it moves', () => {
    const { root, a } = scene(), highlight = new SelectionHighlight();
    highlight.set(root, { id: a.uuid, kind: 'mesh' });
    root.position.z = 4; highlight.update();
    const helper = highlight.group.children[0] as THREE.Box3Helper;
    expect(helper.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(4);
    expect(highlight.bounds()!.getCenter(new THREE.Vector3()).z).toBeCloseTo(4);
  });
  it('marks a bone with a sphere, axes and a link to its parent bone', () => {
    const { root, chest } = skinned(), highlight = new SelectionHighlight();
    expect(highlight.set(root, { id: chest.uuid, kind: 'bone' })).toBe(1);
    expect(highlight.group.children).toHaveLength(3);
    const marker = highlight.group.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    expect(marker.position.y).toBeCloseTo(0.5);
    expect((marker.material as THREE.Material).depthTest).toBe(false);
    chest.position.y = 0.8; highlight.update();
    expect(marker.position.y).toBeCloseTo(0.8);
  });
  it('highlights nothing for expressions or unknown ids', () => {
    const { root } = scene(), highlight = new SelectionHighlight();
    expect(highlight.set(root, { id: 'expression-2', kind: 'system' })).toBe(0);
    expect(highlight.set(root, { id: 'missing', kind: 'node' })).toBe(0);
    expect(highlight.group.children).toHaveLength(0);
    expect(highlight.bounds()).toBeNull();
  });
});
