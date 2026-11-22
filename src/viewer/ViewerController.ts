import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';
import type { AnimationLoopMode, AnimationState, MaterialDetails, ModelSummary } from '../types';
import { DuplicateBoneSync } from './duplicateBoneSync';
import { createFpsMeter } from './fpsMeter';
import { SelectionHighlight, type SelectionRef } from './selectionHighlight';
import { describeVrmMeta, type VRM0MetaLike, type VRM1MetaLike } from './vrmMeta';
import { describeMaterialInfo, listTextureSlots } from './materialInfo';
import { textureThumbnail } from './textureThumbnail';
import { SpringBoneOverlay, countSpringBones } from './springBoneOverlay';
import { retargetQuaterniusClip, type QuaterniusAnimationId, type QuaterniusLibraryId } from './quaterniusAnimations';
import { captureLimits, validateCaptureSize } from '../ui/captureSizes';
import { videoBitrate } from '../ui/videoFormat';

export type BuiltInAnimationId = QuaterniusAnimationId;

const EMPTY_ANIMATION: AnimationState = { name: '', source: null, duration: 0, time: 0, playing: false, loading: false, error: '' };

export class ViewerController {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.01, 1000);
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private vrm: VRM | null = null;
  private model: THREE.Object3D | null = null;
  private grid = new THREE.GridHelper(20, 20, 0x67717c, 0x383e45);
  private fillLight = new THREE.DirectionalLight(0xeef5ff, 2.2);
  private keyLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
  private rimLight = new THREE.DirectionalLight(0xb8d8ff, 2.4);
  private backgroundTexture: THREE.Texture | null = null;
  private backgroundColor = new THREE.Color(0x70777d);
  private backgroundRequest = 0;
  private raf = 0;
  private animate = false;
  private turntable = false;
  private resizeObserver: ResizeObserver;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private sourceClip: THREE.AnimationClip | null = null;
  private animationState: AnimationState = { ...EMPTY_ANIMATION };
  private animationListener: ((state: AnimationState) => void) | null = null;
  private loopMode: AnimationLoopMode = 'repeat';
  private speed = 1;
  private inPlace = true;
  private duplicateBoneSync: DuplicateBoneSync | null = null;
  private quaterniusLibraries = new Map<QuaterniusLibraryId, { scene: THREE.Group; animations: THREE.AnimationClip[] }>();
  private fpsMeter = createFpsMeter();
  private fpsListener: ((fps: number | null) => void) | null = null;
  private loadRequest = 0;
  private highlight = new SelectionHighlight();
  private springs = new SpringBoneOverlay();
  private springsVisible = false;
  private quaterniusLoads = new Map<QuaterniusLibraryId, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 760 ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = this.backgroundColor;
    this.camera.position.set(0, 1.35, 3.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.15, 0);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', this.render);
    this.controls.addEventListener('start', () => this.startLoop());
    this.controls.addEventListener('end', () => setTimeout(() => this.stopLoop(), 350));
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.fillLight.position.set(0, 4, 1);
    this.scene.add(this.fillLight);
    this.keyLight.position.set(3, 5, 4);
    this.scene.add(this.keyLight);
    this.rimLight.position.set(-4, 3, -4);
    this.scene.add(this.rimLight);
    this.scene.add(this.highlight.group);
    this.springs.group.visible = false;
    this.scene.add(this.springs.group);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement!);
    this.resize();
  }

  setAnimationListener(listener: (state: AnimationState) => void) {
    this.animationListener = listener;
    listener({ ...this.animationState });
  }

  /** Receives measured fps while the render loop runs (at most ~2x/second), and null when it goes idle. */
  setFpsListener(listener: ((fps: number | null) => void) | null) {
    this.fpsListener = listener;
    listener?.(this.animate ? this.fpsMeter.read(performance.now()) : null);
  }

  private emitAnimation(patch: Partial<AnimationState> = {}) {
    this.animationState = { ...this.animationState, ...patch };
    this.animationListener?.({ ...this.animationState });
  }

  private resize = () => {
    const host = this.canvas.parentElement!;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  };

  private tick = () => {
    if (!this.animate) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.animationState.playing && this.mixer) {
      this.mixer.update(delta * this.speed);
      const duration = this.animationState.duration;
      const time = this.action ? Math.min(this.action.time, duration) : 0;
      this.emitAnimation({ time });
    }
    if (this.vrm && this.duplicateBoneSync) {
      this.vrm.humanoid.update();
      this.duplicateBoneSync.update();
    }
    this.vrm?.update(delta);
    if (this.turntable && this.model) this.model.rotation.y += delta * 0.35;
    this.controls.update();
    this.syncSprings();
    this.highlight.update();
    this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    this.fpsMeter.frame(now);
    const fps = this.fpsMeter.poll(now);
    if (fps !== undefined) this.fpsListener?.(fps);
    this.raf = requestAnimationFrame(this.tick);
  };

  render = () => { this.syncSprings(); this.highlight.update(); this.renderer.render(this.scene, this.camera); };
  private startLoop() { if (!this.animate) { this.animate = true; this.fpsMeter.reset(); this.clock.start(); this.tick(); } }
  private stopLoop() {
    if (this.turntable || this.animationState.playing) return;
    const wasRunning = this.animate;
    this.animate = false; cancelAnimationFrame(this.raf); this.render();
    if (wasRunning) { this.fpsMeter.reset(); this.fpsListener?.(null); }
  }

  async load(url: string, fileName: string, size: number, onProgress: (n: number) => void): Promise<ModelSummary> {
    const started = performance.now();
    const request = ++this.loadRequest;
    this.unload();
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, event => request === this.loadRequest && event.total && onProgress(event.loaded / event.total));
    if (request !== this.loadRequest) { this.disposeObject(gltf.userData.vrm?.scene ?? gltf.scene); throw new Error('A newer model load replaced this one.'); }
    this.vrm = gltf.userData.vrm ?? null;
    this.model = this.vrm?.scene ?? gltf.scene;
    if (this.vrm) {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(this.vrm);
      const humanoidBones = Object.entries(this.vrm.humanoid.rawHumanBones).flatMap(([boneName, bone]) => bone ? [{ boneName, node: bone.node }] : []);
      this.duplicateBoneSync = new DuplicateBoneSync(this.vrm.scene, humanoidBones);
      this.duplicateBoneSync.update();
      this.mixer = new THREE.AnimationMixer(this.vrm.scene);
      this.mixer.addEventListener('finished', this.onAnimationFinished);
    }
    this.scene.add(this.model);
    this.frameAll();
    this.render();

    let nodes = 0, meshes = 0, triangles = 0, bones = 0;
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    const items: ModelSummary['items'] = [];
    this.model.traverse(object => {
      nodes++;
      const any = object as THREE.Object3D & { isBone?: boolean; isMesh?: boolean; geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      if (any.isBone) { bones++; items.push({ id: object.uuid, label: object.name || 'Unnamed bone', kind: 'bone' }); }
      else if (any.isMesh) {
        meshes++; items.push({ id: object.uuid, label: object.name || `Mesh ${meshes}`, kind: 'mesh' });
        if (any.geometry) triangles += any.geometry.index ? any.geometry.index.count / 3 : (any.geometry.attributes.position?.count ?? 0) / 3;
        for (const material of Array.isArray(any.material) ? any.material : [any.material]) if (material) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      } else if (object !== this.model) items.push({ id: object.uuid, label: object.name || `Node ${nodes}`, kind: 'node' });
    });
    for (const material of materials) items.push({ id: material.uuid, label: material.name || 'Unnamed material', kind: 'material', detail: material.type });
    const meta = this.vrm?.meta;
    const normalMeta = meta as unknown as { name?: string; title?: string; authors?: string[]; author?: string; licenseUrl?: string; otherLicenseUrl?: string } | undefined;
    const expressionManager = this.vrm?.expressionManager;
    const expressions = expressionManager?.expressions.map(e => e.expressionName) ?? [];
    const version = this.vrm ? ((gltf.userData.vrmMeta?.metaVersion as string | undefined) ?? (meta as any)?.metaVersion ?? '1.0') : '2.0';
    this.metaVersion = meta?.metaVersion;
    return {
      name: normalMeta?.name || normalMeta?.title || fileName.replace(/\.(vrm|glb|gltf)$/i, ''), format: this.vrm ? 'VRM' : 'glTF', version,
      generator: gltf.parser.json.asset?.generator ?? 'Not specified', size, loadMs: performance.now() - started,
      nodes, meshes, triangles: Math.round(triangles), materials: materials.size, textures: textures.size, bones, expressions,
      authors: normalMeta?.authors ?? (normalMeta?.author ? [normalMeta.author] : []), license: normalMeta?.licenseUrl ?? normalMeta?.otherLicenseUrl ?? 'Not specified',
      licence: describeVrmMeta(meta as VRM1MetaLike | VRM0MetaLike | undefined), items,
      unsyncedDetachedSkeletons: this.duplicateBoneSync?.unsyncedDetachedSkeletons || undefined
    };
  }

  /** Abandons any in-flight load; its result is disposed instead of being added to the scene. */
  cancelLoad() { this.loadRequest++; }

  private metaVersion: string | undefined;
  private thumbnails = new Map<string, string | null>();

  /** Read-only description of a loaded material (by uuid) with small texture thumbnails, or null when not found. */
  describeMaterial(uuid: string): MaterialDetails | null {
    if (!this.model) return null;
    const users: THREE.Material[] = [];
    this.model.traverse(object => {
      const mesh = object as THREE.Mesh;
      const found = mesh.isMesh && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).find(m => m?.uuid === uuid);
      if (found) users.push(found);
    });
    const material = users[0], meshCount = users.length;
    if (!material) return null;
    const details = describeMaterialInfo(material, meshCount, this.metaVersion);
    const textures = new Map(listTextureSlots(material));
    for (const entry of details.textures) {
      const texture = textures.get(entry.slot);
      if (!texture) continue;
      if (!this.thumbnails.has(texture.uuid)) this.thumbnails.set(texture.uuid, textureThumbnail(texture));
      entry.thumbnail = this.thumbnails.get(texture.uuid) ?? undefined;
    }
    return details;
  }

  unload() {
    this.highlight.clear();
    this.thumbnails.clear();
    this.springs.clear();
    this.clearAnimation();
    this.stopLoop();
    if (!this.model) return;
    this.scene.remove(this.model);
    this.disposeObject(this.model);
    this.vrm = null; this.model = null; this.mixer = null; this.duplicateBoneSync = null; this.render();
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      mats.forEach(material => { Object.values(material).forEach(v => v instanceof THREE.Texture && v.dispose()); material.dispose(); });
    });
  }

  frameAll() {
    if (!this.model) { this.camera.position.set(0, 1.35, 3.2); this.controls.target.set(0, 1.15, 0); this.controls.update(); return; }
    this.frameBox(new THREE.Box3().setFromObject(this.model));
  }

  /** Highlights the explorer item in the viewport. Returns how many objects are highlighted (0 for expressions, unknown ids or no model). */
  setSelection(item: SelectionRef | null) {
    if (this.highlight.matches(this.model, item)) return this.highlight.count;
    const count = this.highlight.set(this.model, item);
    this.render();
    return count;
  }

  /** Fits the camera to the highlighted selection, or the whole model when nothing is highlighted. */
  frameSelection() {
    const box = this.highlight.bounds();
    box ? this.frameBox(box) : this.frameAll();
  }

  private frameBox(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const distance = Math.max(size.x, size.y, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.25;
    this.controls.target.copy(center); this.camera.position.set(center.x, center.y + size.y * 0.04, center.z + distance); this.controls.update(); this.render();
  }

  setView(view: 'front' | 'back' | 'left' | 'right') {
    const target = this.controls.target, distance = this.camera.position.distanceTo(target);
    const vectors = { front: [0, 0, distance], back: [0, 0, -distance], left: [-distance, 0, 0], right: [distance, 0, 0] } as const;
    this.camera.position.set(target.x + vectors[view][0], target.y, target.z + vectors[view][2]); this.controls.update(); this.render();
  }
  toggleGrid() { this.grid.visible = !this.grid.visible; this.render(); return this.grid.visible; }
  toggleTurntable() { this.turntable = !this.turntable; this.turntable ? this.startLoop() : this.stopLoop(); return this.turntable; }

  private onAnimationFinished = () => {
    this.emitAnimation({ playing: false, time: this.animationState.duration });
    this.stopLoop();
  };

  private loadQuaterniusLibrary(libraryId: QuaterniusLibraryId) {
    const loaded = this.quaterniusLibraries.get(libraryId);
    if (loaded) return Promise.resolve(loaded);
    const pending = this.quaterniusLoads.get(libraryId);
    if (pending) return pending;
    const fileName = libraryId === 'ual1' ? 'UAL1_Standard.glb' : 'UAL2_Standard.glb';
    const url = new URL(`animations/quaternius/${fileName}`, document.baseURI).href;
    const load = new GLTFLoader().loadAsync(url).then(gltf => {
      const library = { scene: gltf.scene, animations: gltf.animations };
      this.quaterniusLibraries.set(libraryId, library);
      return library;
    }).finally(() => { this.quaterniusLoads.delete(libraryId); });
    this.quaterniusLoads.set(libraryId, load);
    return load;
  }

  async loadBuiltInAnimation(id: BuiltInAnimationId) {
    if (!this.vrm || !this.mixer) throw new Error('Open a VRM humanoid before choosing a preview animation.');
    this.emitAnimation({ loading: true, error: '' });
    try {
      const [libraryId, animationName] = id.split(':') as [QuaterniusLibraryId, string];
      const library = await this.loadQuaterniusLibrary(libraryId);
      const sourceClip = library.animations.find(clip => clip.name === animationName);
      if (!sourceClip) throw new Error(`The bundled Quaternius clip “${id}” is missing.`);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!this.vrm) throw new Error('The VRM was closed while the animation was loading.');
      const clip = retargetQuaterniusClip(library.scene.clone(true), sourceClip, this.vrm);
      clip.name = id;
      this.setAnimationClip(clip, 'built-in');
      return { name: clip.name, duration: clip.duration };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      this.emitAnimation({ loading: false, error: message });
      throw reason;
    }
  }

  async loadVRMA(url: string, fileName: string) {
    if (!this.vrm || !this.mixer) throw new Error('VRMA retargeting requires an open VRM humanoid.');
    this.emitAnimation({ loading: true, error: '' });
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMAnimationLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
      if (!animations?.length) throw new Error('This file contains no VRM Animation data (VRMC_vrm_animation).');
      const clip = createVRMAnimationClip(animations[0], this.vrm);
      clip.name = fileName.replace(/\.vrma$/i, '');
      this.setAnimationClip(clip, 'file');
      return { name: clip.name, duration: clip.duration };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      this.emitAnimation({ loading: false, error: message });
      throw reason;
    }
  }

  private playableClip() {
    if (!this.sourceClip) return null;
    const clip = this.sourceClip.clone();
    if (this.inPlace) {
      clip.tracks.forEach(track => {
        if (!(track instanceof THREE.VectorKeyframeTrack) || !track.name.endsWith('.position')) return;
        const values = track.values;
        const originX = values[0], originZ = values[2];
        for (let i = 0; i < values.length; i += 3) { values[i] = originX; values[i + 2] = originZ; }
      });
    }
    return clip;
  }

  private setAnimationClip(clip: THREE.AnimationClip, source: 'built-in' | 'file') {
    this.stopAnimationAction();
    this.sourceClip = clip;
    this.createAction();
    this.emitAnimation({ name: clip.name, source, duration: clip.duration, time: 0, playing: false, loading: false, error: '' });
    this.seekAnimation(0);
  }

  private createAction() {
    const clip = this.playableClip();
    if (!clip || !this.mixer) return;
    this.action = this.mixer.clipAction(clip);
    this.applyLoop();
  }

  private applyLoop() {
    if (!this.action) return;
    const loop = this.loopMode === 'once' ? THREE.LoopOnce : this.loopMode === 'pingpong' ? THREE.LoopPingPong : THREE.LoopRepeat;
    this.action.setLoop(loop, this.loopMode === 'once' ? 1 : Infinity);
    this.action.clampWhenFinished = this.loopMode === 'once';
  }

  playAnimation() {
    if (!this.action) throw new Error('Choose or import an animation first.');
    if (this.animationState.time >= this.animationState.duration) { this.action.reset(); this.emitAnimation({ time: 0 }); }
    this.action.paused = false;
    this.action.play();
    this.emitAnimation({ playing: true, error: '' });
    this.startLoop();
  }

  pauseAnimation() {
    if (this.action) this.action.paused = true;
    this.emitAnimation({ playing: false });
    this.stopLoop();
  }

  stopAnimation(resetPose = true) {
    this.stopAnimationAction();
    this.createAction();
    if (resetPose) this.resetPose();
    this.emitAnimation({ playing: false, time: 0 });
    this.stopLoop();
  }

  resetPose() {
    this.vrm?.humanoid.resetNormalizedPose();
    this.vrm?.expressionManager?.resetValues();
    this.vrm?.humanoid.update();
    this.duplicateBoneSync?.update();
    this.vrm?.update(0);
    this.render();
  }

  seekAnimation(time: number) {
    if (!this.action || !this.mixer) return;
    const wasPlaying = this.animationState.playing;
    this.action.paused = false;
    this.action.play();
    this.mixer.setTime(THREE.MathUtils.clamp(time, 0, this.animationState.duration));
    this.action.paused = !wasPlaying;
    this.vrm?.humanoid.update();
    this.duplicateBoneSync?.update();
    this.vrm?.update(0);
    this.emitAnimation({ time: THREE.MathUtils.clamp(time, 0, this.animationState.duration) });
    this.render();
  }

  setAnimationSpeed(speed: number) { this.speed = THREE.MathUtils.clamp(speed, .1, 2); }
  setAnimationLoop(mode: AnimationLoopMode) { this.loopMode = mode; this.applyLoop(); }
  setAnimationInPlace(inPlace: boolean) {
    const time = this.animationState.time, playing = this.animationState.playing;
    this.inPlace = inPlace;
    this.stopAnimationAction(); this.createAction(); this.seekAnimation(time);
    if (playing) this.playAnimation();
  }

  private stopAnimationAction() {
    if (this.action && this.mixer) { this.action.stop(); this.mixer.uncacheClip(this.action.getClip()); }
    this.action = null;
  }

  private clearAnimation() {
    this.stopAnimationAction();
    if (this.mixer) { this.mixer.removeEventListener('finished', this.onAnimationFinished); this.mixer.stopAllAction(); }
    this.sourceClip = null;
    this.emitAnimation({ ...EMPTY_ANIMATION });
  }
  setExpression(name: string, weight: number) { this.vrm?.expressionManager?.setValue(name, weight); this.vrm?.expressionManager?.update(); this.render(); }
  resetExpressions() { this.vrm?.expressionManager?.resetValues(); this.vrm?.expressionManager?.update(); this.render(); }
  setLighting(key: number, fill: number, rim: number, exposure: number) {
    this.keyLight.intensity = THREE.MathUtils.clamp(key, 0, 8);
    this.fillLight.intensity = THREE.MathUtils.clamp(fill, 0, 8);
    this.rimLight.intensity = THREE.MathUtils.clamp(rim, 0, 8);
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(exposure, .25, 2.5);
    this.render();
  }
  setBackgroundColor(color: string) {
    this.backgroundRequest++;
    this.backgroundTexture?.dispose(); this.backgroundTexture = null;
    this.backgroundColor.set(color);
    this.scene.background = this.backgroundColor;
    this.render();
  }
  async setBackgroundImage(url: string) {
    const request = ++this.backgroundRequest;
    const texture = await new THREE.TextureLoader().loadAsync(url);
    if (request !== this.backgroundRequest) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    this.backgroundTexture?.dispose(); this.backgroundTexture = texture;
    this.scene.background = texture;
    this.render();
  }
  /**
   * Builds the spring bone overlay for the current VRM when visible, and rebuilds it after a new model loads.
   * Helpers re-read their bone / collider world matrices when the renderer updates the scene, so no per-frame work is needed here.
   */
  private syncSprings() {
    const manager = this.springsVisible ? this.vrm?.springBoneManager ?? null : null;
    if (!this.springs.matches(manager)) this.springs.set(manager);
  }
  /** Joint and collider counts of the open VRM (zero for glTF or no model). */
  getSpringBoneCounts() { return countSpringBones(this.vrm?.springBoneManager); }
  /** Shows or hides the spring bone (cyan) and collider (magenta) overlay. The choice is kept for models loaded later. */
  setSpringBonesVisible(visible: boolean) {
    this.springsVisible = visible; this.springs.group.visible = visible;
    this.render();
    return this.getSpringBoneCounts();
  }
  private recording = false;
  /** Viewport (CSS pixels + pixel ratio) and the largest drawing buffer this GPU accepts, for the capture dialog. */
  getCaptureInfo() {
    const gl = this.renderer.getContext(), size = this.renderer.getSize(new THREE.Vector2());
    const limits = captureLimits({ maxTextureSize: this.renderer.capabilities.maxTextureSize, maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS) ?? [] });
    return { viewport: { width: size.x, height: size.y, pixelRatio: this.renderer.getPixelRatio() }, limits, recording: this.recording };
  }
  /**
   * Resizes the canvas drawing buffer (not its CSS box) to exactly width×height at pixel ratio 1, matches the camera aspect,
   * and hides the selection and spring helpers. The on-screen pipeline (tone mapping, sRGB output, MSAA, premultiplied alpha)
   * is reused unchanged, so captures match the viewport. Returns the function that restores everything.
   */
  private beginCapture(width: number, height: number, transparent: boolean) {
    const { limits } = this.getCaptureInfo(), error = validateCaptureSize(width, height, limits);
    if (error) throw new Error(error);
    const background = this.scene.background, size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio(), aspect = this.camera.aspect;
    const restore = () => {
      this.scene.background = background; this.highlight.group.visible = true; this.springs.group.visible = this.springsVisible;
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false);
      this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); this.render();
    };
    if (transparent) this.scene.background = null;
    this.highlight.group.visible = false; this.springs.group.visible = false;
    this.renderer.setPixelRatio(1); this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    const gl = this.renderer.getContext();
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      const got = `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`;
      restore();
      throw new Error(`This device could only allocate ${got} for a ${width}×${height} capture. Choose a smaller size.`);
    }
    return restore;
  }
  /** Renders one PNG (data URL) at exactly width×height with the current camera framing; transparent drops the background. */
  captureImage({ width, height, transparent }: { width: number; height: number; transparent: boolean }) {
    if (this.recording) throw new Error('Wait for the video recording to finish.');
    const restore = this.beginCapture(width, height, transparent);
    try { this.render(); return this.canvas.toDataURL('image/png'); }
    finally { restore(); }
  }
  /** Advances animation, spring bones and duplicate skeletons by a fixed timestep (mirrors the live loop). */
  private stepCaptureFrame(delta: number) {
    if (this.mixer && this.action && !this.action.paused) this.mixer.update(delta * this.speed);
    if (this.vrm && this.duplicateBoneSync) { this.vrm.humanoid.update(); this.duplicateBoneSync.update(); }
    this.vrm?.update(delta);
  }
  /**
   * Records a WebM/MP4 of exactly `duration` seconds. Frames are rendered at a fixed timestep (1/fps) and pushed with
   * requestFrame(), paced to wall-clock time so MediaRecorder timestamps line up. The turntable makes exactly one revolution;
   * 'animation' plays the loaded clip from its start. The live loop, orbit controls and resize observer are paused meanwhile,
   * and model rotation, turntable, animation time / play state, canvas size and helpers are restored afterwards.
   * Resolves null when cancelled through `signal`.
   */
  async recordVideo(options: { width: number; height: number; transparent: boolean; duration: number; source: 'turntable' | 'animation'; mimeType: string; fps?: number; signal?: AbortSignal; onProgress?: (elapsed: number) => void }): Promise<Blob | null> {
    const { width, height, transparent, duration, source, mimeType, signal, onProgress } = options, fps = options.fps ?? 30;
    if (typeof MediaRecorder === 'undefined' || typeof this.canvas.captureStream !== 'function') throw new Error('Video recording is not supported here (MediaRecorder or canvas.captureStream is missing).');
    if (this.recording) throw new Error('A recording is already running.');
    if (!this.model) throw new Error('Open a model before recording.');
    if (source === 'animation' && !(this.action && this.mixer)) throw new Error('Choose or import an animation first.');
    const frames = Math.max(1, Math.round(duration * fps)), delta = 1 / fps, model = this.model;
    const turntable = this.turntable, playing = this.animationState.playing, time = this.animationState.time, rotation = model.rotation.y, controls = this.controls.enabled;
    const touchesAnimation = source === 'animation' || playing;
    this.recording = true;
    this.turntable = false;
    if (playing) { if (this.action) this.action.paused = true; this.emitAnimation({ playing: false }); }
    this.stopLoop();
    this.controls.enabled = false;
    this.resizeObserver.disconnect();
    let restore: (() => void) | null = null, stream: MediaStream | null = null, recorder: MediaRecorder | null = null;
    try {
      restore = this.beginCapture(width, height, transparent);
      stream = this.canvas.captureStream(0);
      let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      if (typeof track?.requestFrame !== 'function') { stream.getTracks().forEach(t => t.stop()); stream = this.canvas.captureStream(fps); track = undefined; }
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBitrate(width, height, fps) });
      const chunks: Blob[] = [], active = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve, reject) => {
        active.onstop = () => resolve();
        active.onerror = event => reject((event as Event & { error?: unknown }).error ?? new Error('The video recorder failed.'));
      });
      if (source === 'animation' && this.action && this.mixer) { this.action.reset(); this.action.paused = false; this.action.play(); this.mixer.setTime(0); }
      else if (playing && this.action) this.action.paused = false;
      const wait = (until: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, until - performance.now())));
      recorder.start(1000);
      const started = performance.now();
      for (let frame = 0; frame < frames && !signal?.aborted; frame++) {
        await wait(started + frame * delta * 1000);
        if (signal?.aborted) break;
        if (frame > 0) this.stepCaptureFrame(delta);
        if (source === 'turntable') model.rotation.y = rotation + Math.PI * 2 * frame / frames;
        this.render();
        track?.requestFrame();
        onProgress?.(frame * delta);
      }
      if (!signal?.aborted) await wait(started + frames * delta * 1000);
      onProgress?.(signal?.aborted ? 0 : duration);
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      if (signal?.aborted) return null;
      if (!chunks.length) throw new Error('The recorder produced no video data.');
      return new Blob(chunks, { type: recorder.mimeType || mimeType });
    } finally {
      if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch { /* Already stopping. */ }
      stream?.getTracks().forEach(t => t.stop());
      model.rotation.y = rotation;
      if (touchesAnimation && this.action) this.seekAnimation(time);
      restore?.();
      this.controls.enabled = controls;
      this.recording = false;
      this.resizeObserver.observe(this.canvas.parentElement!);
      this.turntable = turntable;
      if (playing && this.action) this.playAnimation();
      else if (turntable) this.startLoop();
      else this.render();
    }
  }
  /** Legacy wrapper: the current drawing buffer size times `scale`. */
  capture(transparent = false, scale = 1) {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio();
    return this.captureImage({ width: Math.round(size.x * ratio * scale), height: Math.round(size.y * ratio * scale), transparent });
  }
  dispose() { this.unload(); this.highlight.dispose(); this.springs.dispose(); this.backgroundRequest++; this.backgroundTexture?.dispose(); this.resizeObserver.disconnect(); this.controls.dispose(); this.renderer.dispose(); cancelAnimationFrame(this.raf); }
}
