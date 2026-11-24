import * as THREE from 'three';

export type CameraPreset = 'full' | 'portrait' | 'thumbnail';
export const CAMERA_PRESETS: readonly CameraPreset[] = ['full', 'portrait', 'thumbnail'];
/** VRChat avatar thumbnails are 4:3; the thumbnail preset keeps its subject inside a centred 4:3 crop. */
export const THUMBNAIL_ASPECT = 4 / 3;

export const FRAMING_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye'] as const;
export type FramingBone = typeof FRAMING_BONES[number];

export interface FramingSubject {
  /** World-space bounds of the model. */
  bounds: THREE.Box3;
  /** World direction the model faces (only the horizontal part is used). Defaults to +Z, the VRM / glTF front. */
  facing?: THREE.Vector3;
  /** World positions of VRM humanoid bones, when the model has a humanoid. */
  bones?: Partial<Record<FramingBone, THREE.Vector3>>;
}

export interface CameraFraming { position: THREE.Vector3; target: THREE.Vector3 }

/** The vertical slice of the model to fit, and where the camera should sit relative to it. */
interface Region { bottom: number; top: number; width: number; depth: number; x: number; z: number; cameraY: number; fitAspect: number; margin: number }

const flatFacing = (facing?: THREE.Vector3) => {
  const flat = new THREE.Vector3(facing?.x ?? 0, 0, facing?.z ?? 1);
  return Number.isFinite(flat.x) && Number.isFinite(flat.z) && flat.lengthSq() > 1e-8 ? flat.normalize() : new THREE.Vector3(0, 0, 1);
};

/** Horizontal width across the model's facing, and how far its front reaches towards the camera from the centre. */
const projectedExtent = (bounds: THREE.Box3, facing: THREE.Vector3) => {
  const right = new THREE.Vector3(facing.z, 0, -facing.x), center = bounds.getCenter(new THREE.Vector3());
  let minRight = 0, maxRight = 0, front = 0;
  for (let i = 0; i < 8; i++) {
    const corner = new THREE.Vector3(i & 1 ? bounds.max.x : bounds.min.x, 0, i & 2 ? bounds.max.z : bounds.min.z).sub(center).setY(0);
    const across = corner.dot(right);
    minRight = Math.min(minRight, across); maxRight = Math.max(maxRight, across); front = Math.max(front, corner.dot(facing));
  }
  return { width: maxRight - minRight, front };
};

function humanoidRegion(preset: CameraPreset, bounds: THREE.Box3, bones: NonNullable<FramingSubject['bones']>, head: THREE.Vector3, aspect: number): Region {
  const { hips, spine, chest, upperChest, neck, leftEye, rightEye } = bones;
  // Torso length (hips to head) scales every offset, so tiny chibis and tall avatars frame alike.
  const torso = hips && head.y - hips.y > 1e-3 ? head.y - hips.y : Math.max((head.y - bounds.min.y) * 0.45, 0.05);
  // The head bone sits at the skull base: take the bounds top for hair, but ignore tall hats, raised arms and props.
  const headTop = THREE.MathUtils.clamp(bounds.isEmpty() ? -Infinity : bounds.max.y, head.y + 0.18 * torso, head.y + 0.45 * torso);
  const eyeY = leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : leftEye?.y ?? rightEye?.y ?? head.y + 0.4 * (headTop - head.y);
  if (preset === 'portrait') {
    const bottom = upperChest?.y ?? chest?.y ?? (neck ? neck.y - 1.5 * Math.max(head.y - neck.y, 0.02 * torso) : head.y - 0.45 * torso);
    const top = headTop + 0.1 * (headTop - bottom), span = top - bottom;
    return { bottom, top, width: span * 0.8, depth: 0.15 * torso, x: head.x, z: head.z, cameraY: eyeY + 0.03 * span, fitAspect: aspect, margin: 1.06 };
  }
  const upper = chest ?? upperChest;
  const bottom = hips && upper ? (hips.y + upper.y) / 2 : spine?.y ?? head.y - 0.75 * torso;
  const top = headTop + 0.15 * (headTop - bottom), span = top - bottom;
  return { bottom, top, width: span * 0.9, depth: 0.2 * torso, x: head.x, z: head.z, cameraY: eyeY + 0.06 * span, fitAspect: Math.min(aspect, THUMBNAIL_ASPECT), margin: 1.06 };
}

/** Bounding-box framing for glTF models without a humanoid: the top slice of the box stands in for head and torso. */
function boxRegion(preset: CameraPreset, bounds: THREE.Box3, facing: THREE.Vector3, aspect: number): Region {
  const center = bounds.getCenter(new THREE.Vector3()), height = bounds.max.y - bounds.min.y, extent = projectedExtent(bounds, facing);
  if (preset === 'full') return { bottom: bounds.min.y, top: bounds.max.y, width: extent.width, depth: extent.front, x: center.x, z: center.z, cameraY: center.y + 0.15 * height, fitAspect: aspect, margin: 1.1 };
  const share = preset === 'portrait' ? 0.24 : 0.45, bottom = bounds.max.y - share * height, top = bounds.max.y + 0.04 * height, span = top - bottom;
  return { bottom, top, width: Math.min(extent.width, span * 1.2), depth: Math.min(extent.front, span * 0.5), x: center.x, z: center.z, cameraY: top - 0.3 * span, fitAspect: preset === 'thumbnail' ? Math.min(aspect, THUMBNAIL_ASPECT) : aspect, margin: 1.06 };
}

/**
 * Camera position and orbit target for a framing preset, in front of the model (relative to its facing).
 * `fov` is the vertical field of view in degrees, `aspect` the viewport width / height.
 * Returns null when there is nothing to frame (empty bounds and no head bone).
 */
export function frameCameraPreset(preset: CameraPreset, subject: FramingSubject, fov: number, aspect: number): CameraFraming | null {
  const { bounds, bones } = subject, facing = flatFacing(subject.facing), head = bones?.head;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (!head && bounds.isEmpty()) return null;
  // Full body always uses the bounds, so long hair, tails and wide outfits stay in view.
  const region = preset !== 'full' && head && bones ? humanoidRegion(preset, bounds, bones, head, safeAspect) : boxRegion(preset, bounds, facing, safeAspect);
  const tanV = Math.tan(THREE.MathUtils.degToRad(THREE.MathUtils.clamp(fov, 5, 120)) / 2), tanH = tanV * region.fitAspect;
  const span = Math.max(region.top - region.bottom, 1e-3);
  const distance = Math.max(span / 2 / tanV, region.width / 2 / tanH) * region.margin + region.depth;
  const target = new THREE.Vector3(region.x, (region.bottom + region.top) / 2, region.z);
  const position = target.clone().addScaledVector(facing, distance).setY(region.cameraY);
  return { position, target };
}
