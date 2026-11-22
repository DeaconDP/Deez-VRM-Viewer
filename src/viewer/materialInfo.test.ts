import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { classifyAlpha, classifyShader, describeMaterialInfo, listTextureSlots, textureSize } from './materialInfo';

const texture = (width = 0, height = 0) => { const t = new THREE.Texture(); if (width) t.image = { width, height }; return t; };

/** Stand-in for MToonMaterial: maps are prototype accessors over uniforms, like the real class. */
class FakeMToon extends THREE.ShaderMaterial {
  get isMToonMaterial() { return true as const; }
  v0CompatShade = false;
  outlineWidthMode = 'worldCoordinates';
  outlineWidthFactor = 0.02;
  shadeColorFactor = new THREE.Color(0x336699);
  color = new THREE.Color(0xffffff);
  constructor() { super({ uniforms: { map: { value: null }, shadeMultiplyTexture: { value: null }, matcapTexture: { value: null } } }); (this as { type: string }).type = 'MToonMaterial'; }
  get map() { return this.uniforms.map.value; }
  set map(v) { this.uniforms.map.value = v; }
  get shadeMultiplyTexture() { return this.uniforms.shadeMultiplyTexture.value; }
  get matcapTexture() { return this.uniforms.matcapTexture.value; }
}

describe('classifyShader', () => {
  it('detects PBR, unlit and other materials', () => {
    expect(classifyShader(new THREE.MeshStandardMaterial()).shader).toBe('standard');
    expect(classifyShader(new THREE.MeshPhysicalMaterial()).shader).toBe('physical');
    expect(classifyShader(new THREE.MeshBasicMaterial()).shaderLabel).toBe('Unlit');
    expect(classifyShader(new THREE.MeshLambertMaterial())).toEqual({ shader: 'other', shaderLabel: 'Other (MeshLambertMaterial)' });
  });

  it('detects MToon by isMToonMaterial, as 0.x compat for VRM 0 models or v0 shading', () => {
    const mtoon = new FakeMToon();
    expect(classifyShader(mtoon, '1')).toEqual({ shader: 'mtoon1', shaderLabel: 'MToon 1.0' });
    expect(classifyShader(mtoon, '0').shaderLabel).toBe('MToon 0.x compat');
    mtoon.v0CompatShade = true;
    expect(classifyShader(mtoon).shader).toBe('mtoon0');
    expect(classifyShader({ isMToonMaterial: true, type: 'X' } as unknown as THREE.Material).shader).toBe('mtoon1');
  });
});

describe('classifyAlpha', () => {
  it('maps transparent, alphaTest and default to BLEND, MASK and OPAQUE', () => {
    expect(classifyAlpha(new THREE.MeshStandardMaterial())).toEqual({ alphaMode: 'OPAQUE' });
    expect(classifyAlpha(new THREE.MeshStandardMaterial({ alphaTest: 0.5 }))).toEqual({ alphaMode: 'MASK', alphaCutoff: 0.5 });
    expect(classifyAlpha(new THREE.MeshStandardMaterial({ transparent: true }))).toEqual({ alphaMode: 'BLEND' });
  });
});

describe('listTextureSlots', () => {
  it('lists every non-null texture property in a stable slot order', () => {
    const map = texture(), normal = texture(), ao = texture(), rough = texture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap: normal, aoMap: ao, roughnessMap: rough });
    expect(listTextureSlots(material).map(([slot]) => slot)).toEqual(['map', 'normalMap', 'roughnessMap', 'aoMap']);
    expect(listTextureSlots(material)[0][1]).toBe(map);
    expect(listTextureSlots(new THREE.MeshBasicMaterial())).toEqual([]);
  });

  it('reads MToon texture getters without mutating the material', () => {
    const mtoon = new FakeMToon(), map = texture(), shade = texture();
    mtoon.map = map; mtoon.uniforms.shadeMultiplyTexture.value = shade;
    const version = mtoon.version;
    expect(listTextureSlots(mtoon)).toEqual([['map', map], ['shadeMultiplyTexture', shade]]);
    expect(mtoon.version).toBe(version);
  });
});

describe('textureSize', () => {
  it('reads image or video dimensions', () => {
    expect(textureSize(texture(512, 256))).toEqual({ width: 512, height: 256 });
    const video = new THREE.Texture(); video.image = { videoWidth: 640, videoHeight: 360, width: 0, height: 0 };
    expect(textureSize(video)).toEqual({ width: 640, height: 360 });
    expect(textureSize(new THREE.Texture())).toEqual({ width: 0, height: 0 });
  });
});

describe('describeMaterialInfo', () => {
  it('describes a PBR material', () => {
    const map = texture(1024, 1024); map.name = 'body';
    const material = new THREE.MeshStandardMaterial({ name: 'Body', color: 0xff8800, map, side: THREE.DoubleSide, alphaTest: 0.25 });
    const details = describeMaterialInfo(material, 3);
    expect(details).toMatchObject({ uuid: material.uuid, name: 'Body', type: 'MeshStandardMaterial', shader: 'standard', shaderLabel: 'PBR Standard', alphaMode: 'MASK', alphaCutoff: 0.25, doubleSided: true, baseColor: '#ff8800', meshCount: 3 });
    expect(details.shadeColor).toBeUndefined();
    expect(details.outlineWidthMode).toBeUndefined();
    expect(details.textures).toEqual([{ slot: 'map', uuid: map.uuid, name: 'body', width: 1024, height: 1024 }]);
  });

  it('adds MToon shade colour and outline settings', () => {
    const details = describeMaterialInfo(new FakeMToon(), 1, '0');
    expect(details).toMatchObject({ name: 'Unnamed material', shader: 'mtoon0', shadeColor: '#336699', outlineWidthMode: 'worldCoordinates', outlineWidthFactor: 0.02, doubleSided: false, alphaMode: 'OPAQUE' });
  });
});
