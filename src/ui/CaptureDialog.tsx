import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Camera, Download, Film, Square, X } from 'lucide-preact';
import type { ViewerController } from '../viewer/ViewerController';
import { EXPORT_FILTERS, saveLocalFile } from '../platform/exportFile';
import { CAPTURE_PRESETS, VIDEO_DURATION, captureFileName, clampDuration, exportBaseName, parseDimension, presetSize, validateCaptureSize, videoSize, type CapturePresetId, type CaptureSize } from './captureSizes';
import { pickVideoFormat } from './videoFormat';
import './captureDialog.css';

type Mode = 'image' | 'video';
type VideoSource = 'turntable' | 'animation';
type Recorder = { status: 'idle' | 'recording' | 'saving'; elapsed: number; total: number };

const FALLBACK_INFO = { viewport: { width: 1280, height: 720, pixelRatio: 1 }, limits: { maxDimension: 4096, maxPixels: 4096 * 4096 }, recording: false };
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function videoSupport() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return { format: null, error: 'Video recording needs MediaRecorder and canvas.captureStream, which this browser or webview does not provide.' };
  const format = pickVideoFormat(type => MediaRecorder.isTypeSupported(type));
  return format ? { format, error: '' } : { format: null, error: 'This browser cannot record WebM or MP4 video.' };
}

/** Screenshot and video export dialog. Escape or Cancel stops a recording; closing the dialog also cancels it. */
export function CaptureDialog({ controller, modelName, hasModel, hasAnimation, onSaveImage, onClose }: {
  controller: ViewerController | null; modelName: string | undefined; hasModel: boolean; hasAnimation: boolean;
  onSaveImage: (options: CaptureSize & { transparent: boolean }) => Promise<boolean>; onClose: () => void;
}) {
  const info = useMemo(() => controller?.getCaptureInfo() ?? FALLBACK_INFO, [controller]);
  const support = useMemo(videoSupport, []);
  const [mode, setMode] = useState<Mode>('image');
  const [transparent, setTransparent] = useState(false);
  const [preset, setPreset] = useState<CapturePresetId>('current');
  const [customWidth, setCustomWidth] = useState('1920'), [customHeight, setCustomHeight] = useState('1080');
  const [duration, setDuration] = useState(String(VIDEO_DURATION.default));
  const [source, setSource] = useState<VideoSource>('turntable');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [recorder, setRecorder] = useState<Recorder>({ status: 'idle', elapsed: 0, total: 0 });
  const abort = useRef<AbortController | null>(null);
  const recording = recorder.status !== 'idle';

  // Closing the dialog (Escape, backdrop, unmount) never leaves a recording running.
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { if (!hasAnimation && source === 'animation') setSource('turntable'); }, [hasAnimation, source]);
  useEffect(() => {
    if (!recording) return;
    const keys = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); abort.current?.abort(); } };
    addEventListener('keydown', keys, true);
    return () => removeEventListener('keydown', keys, true);
  }, [recording]);

  const sizeOf = (id: CapturePresetId) => presetSize(id, info.viewport, info.limits);
  const width = preset === 'custom' ? parseDimension(customWidth) : sizeOf(preset)!.width;
  const height = preset === 'custom' ? parseDimension(customHeight) : sizeOf(preset)!.height;
  const sizeError = preset === 'custom' ? validateCaptureSize(width, height, info.limits) : '';
  const videoOut = sizeError ? null : videoSize({ width, height });
  const videoAlpha = !!support.format?.alpha;
  const alphaBlocked = mode === 'video' && !videoAlpha;
  const useTransparent = transparent && !alphaBlocked;
  const seconds = clampDuration(Number(duration));
  const output = mode === 'image' ? (sizeError ? null : { width, height }) : videoOut;
  const choosePreset = (id: CapturePresetId) => {
    if (id === 'custom' && preset !== 'custom') { setCustomWidth(String(width || 1920)); setCustomHeight(String(height || 1080)); }
    setPreset(id); setError('');
  };

  const saveImage = async () => {
    if (!output || busy) return;
    setBusy(true); setError('');
    try { if (await onSaveImage({ ...output, transparent: useTransparent })) onClose(); }
    catch (reason) { console.error(reason); setError(message(reason)); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!controller || !videoOut || !support.format || recording) return;
    const format = support.format, signal = (abort.current = new AbortController()).signal;
    setError(''); setRecorder({ status: 'recording', elapsed: 0, total: seconds });
    try {
      const blob = await controller.recordVideo({ ...videoOut, transparent: useTransparent, duration: seconds, source, mimeType: format.mimeType, signal, onProgress: elapsed => setRecorder(old => ({ ...old, elapsed })) });
      if (!blob) { setRecorder({ status: 'idle', elapsed: 0, total: 0 }); return; }
      setRecorder(old => ({ ...old, status: 'saving', elapsed: seconds }));
      const result = await saveLocalFile({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        fileName: `${exportBaseName(modelName)}-${source}.${format.extension}`,
        mimeType: format.baseType,
        title: 'Save video',
        filters: [EXPORT_FILTERS[format.extension]]
      });
      setRecorder({ status: 'idle', elapsed: 0, total: 0 });
      if (result.saved) onClose();
    } catch (reason) {
      console.error(reason); setError(message(reason)); setRecorder({ status: 'idle', elapsed: 0, total: 0 });
    } finally { abort.current = null; }
  };

  const videoBlocked = !hasModel ? 'Open a model before recording a video.' : support.error;
  const label = (id: CapturePresetId) => {
    const presetLabel = CAPTURE_PRESETS.find(p => p.id === id)!.label, size = sizeOf(id);
    if (!size) return presetLabel;
    const shown = mode === 'video' ? videoSize(size) : size;
    return `${presetLabel} · ${shown.width}×${shown.height}`;
  };

  return <div class="modal-backdrop" onClick={() => !recording && onClose()}>
    <div class="dialog capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-title" onClick={e => e.stopPropagation()}
      data-capture-mode={mode} data-recording={recorder.status === 'recording'} data-recorder-status={recorder.status} data-output-size={output ? `${output.width}x${output.height}` : ''} data-video-format={support.format?.mimeType ?? ''}>
      <div class="dialog-head"><h2 id="capture-title">Capture</h2><button onClick={onClose} aria-label="Close capture dialog"><X /></button></div>
      <div class="capture-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'image'} class={mode === 'image' ? 'selected' : ''} disabled={recording} onClick={() => { setMode('image'); setError(''); }} data-capture-tab="image"><Camera /> Image</button>
        <button role="tab" aria-selected={mode === 'video'} class={mode === 'video' ? 'selected' : ''} disabled={recording} onClick={() => { setMode('video'); setError(''); }} data-capture-tab="video"><Film /> Record video</button>
      </div>
      <fieldset class="capture-fields" disabled={recording || busy}>
        <div class="capture-row"><span>Background</span><div class="capture-toggle" role="group" aria-label="Background">
          <button type="button" aria-pressed={!useTransparent} class={!useTransparent ? 'selected' : ''} onClick={() => setTransparent(false)} data-capture-background="scene">Scene background</button>
          <button type="button" aria-pressed={useTransparent} class={useTransparent ? 'selected' : ''} disabled={alphaBlocked} title={alphaBlocked ? 'This video format cannot store transparency' : undefined} onClick={() => setTransparent(true)} data-capture-background="transparent">Transparent</button>
        </div></div>
        <label class="capture-row"><span>Size</span><select value={preset} onChange={e => choosePreset(e.currentTarget.value as CapturePresetId)} data-capture-size>
          {CAPTURE_PRESETS.map(p => <option value={p.id} key={p.id}>{label(p.id)}</option>)}
        </select></label>
        {preset === 'custom' && <div class="capture-row"><span>Custom</span><div class="capture-custom">
          <input type="number" inputMode="numeric" min={64} max={8192} step={1} value={customWidth} onInput={e => setCustomWidth(e.currentTarget.value)} aria-label="Width in pixels" aria-invalid={!!sizeError} data-capture-width />
          <i>×</i>
          <input type="number" inputMode="numeric" min={64} max={8192} step={1} value={customHeight} onInput={e => setCustomHeight(e.currentTarget.value)} aria-label="Height in pixels" aria-invalid={!!sizeError} data-capture-height />
        </div></div>}
        {mode === 'video' && <>
          <label class="capture-row"><span>Source</span><select value={source} onChange={e => setSource(e.currentTarget.value as VideoSource)} data-video-source>
            <option value="turntable">Turntable (one full turn)</option>
            <option value="animation" disabled={!hasAnimation}>Current animation{hasAnimation ? '' : ' (none loaded)'}</option>
          </select></label>
          <label class="capture-row"><span>Duration</span><div class="capture-duration"><input type="number" min={VIDEO_DURATION.min} max={VIDEO_DURATION.max} step={1} value={duration} onInput={e => setDuration(e.currentTarget.value)} onBlur={() => setDuration(String(seconds))} aria-label="Duration in seconds" data-video-duration /><small>s (2–20)</small></div></label>
        </>}
      </fieldset>
      {sizeError && <p class="inline-error" role="alert" data-capture-error>{sizeError}</p>}
      {mode === 'video' && videoBlocked && <p class="inline-error" role="status" data-video-unsupported>{videoBlocked}</p>}
      {error && <p class="inline-error" role="alert" data-capture-error>{error}</p>}
      {mode === 'video' && recording && <div class="capture-progress" role="status" data-video-progress>
        <div><span>{recorder.status === 'saving' ? 'Saving…' : 'Recording…'}</span><output data-video-elapsed>{recorder.elapsed.toFixed(1)} / {recorder.total.toFixed(1)} s</output></div>
        <div class="progress"><i style={{ width: `${Math.min(100, recorder.total ? recorder.elapsed / recorder.total * 100 : 0)}%` }} /></div>
      </div>}
      <p class="capture-summary">{output ? <>Output <b>{output.width}×{output.height}</b> {mode === 'image' ? 'PNG' : `${support.format?.extension.toUpperCase() ?? 'video'} · 30 fps`}{useTransparent ? ' · transparent' : ''}{mode === 'video' && output.width * output.height < width * height ? ' · capped to 1080p' : ''}</> : 'Choose a valid size.'} Everything stays local.</p>
      <div class="dialog-actions">
        {mode === 'image'
          ? <button class="primary" disabled={!output || busy} onClick={() => void saveImage()} data-capture-save><Download /> {busy ? 'Saving…' : 'Save PNG'}</button>
          : recording
            ? <button class="secondary" disabled={recorder.status === 'saving'} onClick={() => abort.current?.abort()} data-video-cancel><Square /> Cancel</button>
            : <button class="primary" disabled={!output || !!videoBlocked || !controller} onClick={() => void record()} data-video-record><Film /> Record {seconds} s</button>}
      </div>
    </div>
  </div>;
}
