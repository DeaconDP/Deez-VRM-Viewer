import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frameCameraPreset, type FramingSubject } from './cameraPresets';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** A 1.6 m humanoid standing at the origin, facing +Z, arms in T-pose. */
const avatar = (): FramingSubject => ({
  bounds: new THREE.Box3(v(-0.8, 0, -0.15), v(0.8, 1.6, 0.15)),
  bones: { hips: v(0, 0.9, 0), spine: v(0, 1.0, 0), chest: v(0, 1.1, 0), upperChest: v(0, 1.22, 0), neck: v(0, 1.35, 0), head: v(0, 1.42, 0), leftEye: v(0.03, 1.5, 0.08), rightEye: v(-0.03, 1.5, 0.08) }
});
const FOV = 36;

/** True when the world point projects inside the camera's view (with the given horizontal aspect). */
const inView = (framing: { position: THREE.Vector3; target: THREE.Vector3 }, point: THREE.Vector3, aspect: number) => {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 100);
  camera.position.copy(framing.position); camera.lookAt(framing.target); camera.updateMatrixWorld();
  const p = point.clone().project(camera);
  return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1;
};

describe('frameCameraPreset', () => {
  it('returns null with nothing to frame', () => {
    expect(frameCameraPreset('full', { bounds: new THREE.Box3() }, FOV, 1)).toBeNull();
  });

  it('full body keeps the whole bounds in view, from the front and slightly above centre', () => {
    const subject = avatar(), framing = frameCameraPreset('full', subject, FOV, 16 / 9)!;
    expect(framing.position.z).toBeGreaterThan(1);
    expect(framing.position.x).toBeCloseTo(0);
    expect(framing.position.y).toBeGreaterThan(framing.target.y);
    for (const corner of [v(-0.8, 0, 0.15), v(0.8, 1.6, 0.15), v(0, 0, 0), v(0, 1.6, 0)]) expect(inView(framing, corner, 16 / 9)).toBe(true);
  });

  it('full body backs off for a narrow portrait viewport', () => {
    const wide = frameCameraPreset('full', avatar(), FOV, 2)!, narrow = frameCameraPreset('full', avatar(), FOV, 0.5)!;
    expect(narrow.position.z).toBeGreaterThan(wide.position.z);
    expect(inView(narrow, v(0.8, 1.2, 0), 0.5)).toBe(true);
  });

  it('portrait frames head and shoulders, not the hips', () => {
    const framing = frameCameraPreset('portrait', avatar(), FOV, 16 / 9)!;
    expect(inView(framing, v(0, 1.62, 0), 16 / 9)).toBe(true); // hair above the head bone
    expect(inView(framing, v(0, 1.25, 0.1), 16 / 9)).toBe(true); // upper chest
    expect(inView(framing, v(0, 0.9, 0), 16 / 9)).toBe(false); // hips
    expect(framing.position.z).toBeLessThan(frameCameraPreset('full', avatar(), FOV, 16 / 9)!.position.z);
    expect(framing.position.y).toBeGreaterThan(1.45);
  });

  it('thumbnail shows the upper body from mid-torso, camera above eye level, inside a 4:3 crop', () => {
    const framing = frameCameraPreset('thumbnail', avatar(), FOV, 16 / 9)!;
    expect(framing.position.y).toBeGreaterThan(1.5);
    expect(framing.position.y).toBeGreaterThan(framing.target.y);
    for (const point of [v(0, 1.62, 0), v(0, 1.02, 0.1), v(0.25, 1.3, 0)]) expect(inView(framing, point, 4 / 3)).toBe(true);
    expect(inView(framing, v(0, 0.6, 0), 4 / 3)).toBe(false); // knees
    const portrait = frameCameraPreset('portrait', avatar(), FOV, 16 / 9)!;
    expect(framing.position.z).toBeGreaterThan(portrait.position.z);
  });

  it('frames relative to the model facing', () => {
    const subject = { ...avatar(), facing: v(1, 0, 0) };
    const framing = frameCameraPreset('portrait', subject, FOV, 1)!;
    expect(framing.position.x).toBeGreaterThan(0.5);
    expect(framing.position.z).toBeCloseTo(0);
    const back = frameCameraPreset('full', { ...avatar(), facing: v(0, 0.3, -2) }, FOV, 1)!;
    expect(back.position.z).toBeLessThan(-1);
  });

  it('ignores tall props when finding the top of the head', () => {
    const subject = avatar();
    subject.bounds.max.y = 3; // a raised staff
    const framing = frameCameraPreset('portrait', subject, FOV, 1)!;
    expect(framing.target.y).toBeLessThan(1.6);
  });

  it('falls back to the bounding box for glTF without bones', () => {
    const bounds = new THREE.Box3(v(-0.3, 0, -0.2), v(0.3, 1.8, 0.2));
    const full = frameCameraPreset('full', { bounds }, FOV, 1)!, portrait = frameCameraPreset('portrait', { bounds }, FOV, 1)!, thumb = frameCameraPreset('thumbnail', { bounds }, FOV, 1)!;
    expect(inView(full, v(0.3, 1.8, 0.2), 1) && inView(full, v(-0.3, 0, 0.2), 1)).toBe(true);
    expect(portrait.target.y).toBeGreaterThan(1.4);
    expect(inView(portrait, v(0, 0.9, 0), 1)).toBe(false);
    expect(thumb.position.z).toBeGreaterThan(portrait.position.z);
    expect(thumb.position.z).toBeLessThan(full.position.z);
  });

  it('survives degenerate aspect and facing input', () => {
    const framing = frameCameraPreset('full', { ...avatar(), facing: v(0, 1, 0) }, FOV, Number.NaN)!;
    expect(Number.isFinite(framing.position.z)).toBe(true);
    expect(framing.position.z).toBeGreaterThan(0);
  });
});
