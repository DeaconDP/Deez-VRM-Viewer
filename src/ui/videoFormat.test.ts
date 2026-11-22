import { describe, expect, it } from 'vitest';
import { describeVideoMime, pickVideoFormat, videoBitrate } from './videoFormat';

describe('pickVideoFormat', () => {
  it('prefers VP9 WebM with alpha', () => {
    expect(pickVideoFormat(() => true)).toEqual({ mimeType: 'video/webm;codecs=vp9', baseType: 'video/webm', extension: 'webm', alpha: true });
  });
  it('falls through the candidates in order', () => {
    const seen: string[] = [];
    const format = pickVideoFormat(type => { seen.push(type); return type === 'video/webm'; });
    expect(seen).toEqual(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
    expect(format).toEqual({ mimeType: 'video/webm', baseType: 'video/webm', extension: 'webm', alpha: false });
  });
  it('uses VP8 when VP9 is missing', () => {
    expect(pickVideoFormat(type => type.endsWith('vp8'))?.alpha).toBe(true);
  });
  it('picks MP4 without alpha on Safari-like recorders', () => {
    expect(pickVideoFormat(type => type === 'video/mp4')).toEqual({ mimeType: 'video/mp4', baseType: 'video/mp4', extension: 'mp4', alpha: false });
  });
  it('returns null when nothing is supported or the check throws', () => {
    expect(pickVideoFormat(() => false)).toBeNull();
    expect(pickVideoFormat(() => { throw new Error('no'); })).toBeNull();
  });
});

describe('describeVideoMime', () => {
  it('reads codecs case-insensitively', () => {
    expect(describeVideoMime('video/WebM;codecs="VP9"').alpha).toBe(true);
    expect(describeVideoMime('video/mp4;codecs=avc1').extension).toBe('mp4');
    expect(describeVideoMime('video/webm;codecs=av1').alpha).toBe(false);
  });
});

describe('videoBitrate', () => {
  it('scales with pixels and stays in 2–16 Mbps', () => {
    expect(videoBitrate(1920, 1080, 30)).toBe(9_331_200);
    expect(videoBitrate(64, 64, 30)).toBe(2_000_000);
    expect(videoBitrate(1920, 1080, 120)).toBe(16_000_000);
  });
});
