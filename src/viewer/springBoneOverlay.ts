import * as THREE from 'three';
import { VRMSpringBoneColliderHelper, VRMSpringBoneJointHelper, type VRMSpringBoneCollider, type VRMSpringBoneJoint } from '@pixiv/three-vrm';

/** Joint lines and hit-radius spheres. */
export const SPRING_JOINT_COLOR = 0x22d3ee;
/** Collider spheres, capsules and planes. */
export const SPRING_COLLIDER_COLOR = 0xff3df0;

const OVERLAY_ORDER = 998;

export type SpringBoneCounts = { joints: number; colliders: number };
/** The parts of `VRMSpringBoneManager` the overlay reads (structural, so tests can pass plain objects). */
export type SpringBoneSource<J = VRMSpringBoneJoint, C = VRMSpringBoneCollider> = {
  joints: Iterable<J & { colliderGroups?: { colliders: C[] }[] }>;
  colliderGroups: { colliders: C[] }[];
};

/** Unique joints and colliders of a spring bone manager, including colliders only referenced by joints. */
export function collectSpringBones<J, C>(source: SpringBoneSource<J, C> | null | undefined) {
  if (!source) return { joints: [] as J[], colliders: [] as C[] };
  const joints = [...new Set(source.joints)];
  const colliders = new Set<C>();
  for (const group of source.colliderGroups) for (const collider of group.colliders) colliders.add(collider);
  for (const joint of joints) for (const group of joint.colliderGroups ?? []) for (const collider of group.colliders) colliders.add(collider);
  return { joints: joints as J[], colliders: [...colliders] };
}

export function countSpringBones(source: SpringBoneSource<unknown, unknown> | null | undefined): SpringBoneCounts {
  const { joints, colliders } = collectSpringBones(source);
  return { joints: joints.length, colliders: colliders.length };
}

/** Bone → tail pairs for each joint (tail is null for VRM 0.x leaf joints without a child node). */
export function springBonePairs<B>(joints: Iterable<{ bone: B; child: B | null }>) {
  return [...joints].map(({ bone, child }) => ({ bone, child }));
}

const styleHelper = (helper: THREE.Object3D, color: number) => {
  helper.traverse(object => {
    const line = object as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    if (!line.isLineSegments) return;
    line.renderOrder = OVERLAY_ORDER; line.frustumCulled = false;
    line.material.color.setHex(color);
    line.material.depthTest = false; line.material.depthWrite = false; line.material.transparent = true; line.material.toneMapped = false;
  });
  return helper;
};

type Helper = THREE.Object3D & { dispose(): void };

/**
 * Viewport overlay of VRM spring bones (cyan) and their colliders (magenta), drawn on top of the model with the
 * three-vrm helpers. Helpers copy their bone / collider world matrix inside `updateMatrixWorld`, which the renderer
 * calls on the scene before every draw, so they follow the animated pose. The model itself is never touched.
 */
export class SpringBoneOverlay {
  readonly group = new THREE.Group();
  private source: SpringBoneSource | null = null;
  private helpers: Helper[] = [];
  private _counts: SpringBoneCounts = { joints: 0, colliders: 0 };

  constructor() { this.group.name = 'SpringBoneOverlay'; }

  get counts() { return { ...this._counts }; }
  matches(source: SpringBoneSource | null) { return source === this.source; }

  /** Replaces the helpers with ones for `source` (null clears). Returns joint and collider counts. */
  set(source: SpringBoneSource | null) {
    this.clear();
    this.source = source;
    const { joints, colliders } = collectSpringBones(source);
    this._counts = { joints: joints.length, colliders: colliders.length };
    for (const joint of joints) this.add(new VRMSpringBoneJointHelper(joint), SPRING_JOINT_COLOR);
    for (const collider of colliders) {
      try { this.add(new VRMSpringBoneColliderHelper(collider), SPRING_COLLIDER_COLOR); }
      catch { /* Unknown collider shape (custom extension): counted but not drawn. */ }
    }
    return this.counts;
  }

  private add(helper: Helper, color: number) {
    this.helpers.push(styleHelper(helper, color) as Helper);
    this.group.add(helper);
  }

  clear() {
    for (const helper of this.helpers) {
      this.group.remove(helper);
      helper.dispose();
      helper.traverse(object => ((object as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
    }
    this.helpers = []; this.source = null; this._counts = { joints: 0, colliders: 0 };
  }

  dispose() { this.clear(); this.group.removeFromParent(); }
}
