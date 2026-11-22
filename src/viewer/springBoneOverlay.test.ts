import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  VRMSpringBoneCollider, VRMSpringBoneColliderShapeCapsule, VRMSpringBoneColliderShapeSphere, VRMSpringBoneJoint, VRMSpringBoneManager
} from '@pixiv/three-vrm';
import { SPRING_COLLIDER_COLOR, SPRING_JOINT_COLOR, SpringBoneOverlay, collectSpringBones, countSpringBones, springBonePairs } from './springBoneOverlay';

function rig() {
  const root = new THREE.Group(), head = new THREE.Bone(), hair = new THREE.Bone(), tip = new THREE.Bone(), lone = new THREE.Bone();
  head.position.set(0, 1.5, 0); hair.position.set(0, 0.1, -0.05); tip.position.set(0, -0.2, 0); lone.position.set(0.2, 0, 0);
  root.add(head); head.add(hair, lone); hair.add(tip);
  const sphere = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ radius: 0.1 }));
  const capsule = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ radius: 0.05, tail: new THREE.Vector3(0, 0.2, 0) }));
  const extra = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({ radius: 0.02 }));
  head.add(sphere, capsule, extra);
  const headGroup = { name: 'head', colliders: [sphere, capsule] }, sharedGroup = { colliders: [capsule] }, privateGroup = { colliders: [extra] };
  const manager = new VRMSpringBoneManager();
  const joints = [new VRMSpringBoneJoint(hair, tip, { hitRadius: 0.03 }, [headGroup, sharedGroup]), new VRMSpringBoneJoint(tip, null, { hitRadius: 0.02 }, [headGroup]), new VRMSpringBoneJoint(lone, null, {}, [privateGroup])];
  joints.forEach(joint => manager.addJoint(joint));
  root.updateMatrixWorld(true);
  manager.setInitState();
  return { root, head, hair, tip, lone, sphere, capsule, extra, manager, joints };
}

describe('collectSpringBones', () => {
  it('returns unique joints and colliders, including colliders only referenced by joints', () => {
    const { manager, joints, sphere, capsule, extra } = rig();
    const { joints: found, colliders } = collectSpringBones(manager);
    expect(found).toEqual(joints);
    expect(new Set(colliders)).toEqual(new Set([sphere, capsule, extra]));
    expect(colliders).toHaveLength(3);
    expect(countSpringBones(manager)).toEqual({ joints: 3, colliders: 3 });
  });

  it('works on plain structural sources and handles null', () => {
    const a = new THREE.Object3D(), b = new THREE.Object3D();
    expect(countSpringBones({ joints: [{ colliderGroups: [{ colliders: [a] }] }], colliderGroups: [{ colliders: [a, b] }, { colliders: [] }] })).toEqual({ joints: 1, colliders: 2 });
    expect(countSpringBones(null)).toEqual({ joints: 0, colliders: 0 });
    expect(collectSpringBones(undefined)).toEqual({ joints: [], colliders: [] });
  });

  it('pairs each joint bone with its tail', () => {
    const { joints, hair, tip, lone } = rig();
    expect(springBonePairs(joints)).toEqual([{ bone: hair, child: tip }, { bone: tip, child: null }, { bone: lone, child: null }]);
  });
});

describe('SpringBoneOverlay', () => {
  const lines = (group: THREE.Object3D) => {
    const found: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
    group.traverse(o => { if ((o as THREE.LineSegments).isLineSegments) found.push(o as never); });
    return found;
  };

  it('draws a cyan helper per joint and a magenta helper per collider, on top of the model', () => {
    const { manager } = rig();
    const overlay = new SpringBoneOverlay();
    expect(overlay.set(manager)).toEqual({ joints: 3, colliders: 3 });
    expect(overlay.matches(manager)).toBe(true);
    const drawn = lines(overlay.group);
    expect(drawn).toHaveLength(6);
    expect(drawn.filter(l => l.material.color.getHex() === SPRING_JOINT_COLOR)).toHaveLength(3);
    expect(drawn.filter(l => l.material.color.getHex() === SPRING_COLLIDER_COLOR)).toHaveLength(3);
    expect(drawn.every(l => !l.material.depthTest && l.renderOrder > 0)).toBe(true);
  });

  it('follows the pose: helpers copy their bone world matrix when the scene updates', () => {
    const { root, manager, hair } = rig();
    const scene = new THREE.Scene(), overlay = new SpringBoneOverlay();
    scene.add(root, overlay.group); overlay.set(manager);
    const jointHelper = overlay.group.children[0];
    root.position.set(3, 0, 0); scene.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(jointHelper.matrixWorld).toArray()).toEqual(hair.getWorldPosition(new THREE.Vector3()).toArray());
  });

  it('never adds anything to the model', () => {
    const { root, manager } = rig();
    let before = 0; root.traverse(() => { before++; });
    const overlay = new SpringBoneOverlay(); overlay.set(manager);
    let after = 0; root.traverse(() => { after++; });
    expect(after).toBe(before);
  });

  it('disposes geometry and materials on clear, and detaches on dispose', () => {
    const { manager } = rig();
    const scene = new THREE.Scene(), overlay = new SpringBoneOverlay();
    scene.add(overlay.group); overlay.set(manager);
    const drawn = lines(overlay.group);
    let disposed = 0;
    for (const line of drawn) { line.geometry.addEventListener('dispose', () => disposed++); line.material.addEventListener('dispose', () => disposed++); }
    overlay.clear();
    expect(disposed).toBe(drawn.length * 2);
    expect(overlay.group.children).toHaveLength(0);
    expect(overlay.counts).toEqual({ joints: 0, colliders: 0 });
    expect(overlay.matches(null)).toBe(true);
    overlay.dispose();
    expect(overlay.group.parent).toBeNull();
  });
});
