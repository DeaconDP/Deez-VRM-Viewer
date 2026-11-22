import { describe, expect, it } from 'vitest';
import { createOpenQueue, errorMessage } from './openQueue';

describe('createOpenQueue', () => {
  it('queues values until a listener subscribes, then flushes them in order', () => {
    const queue = createOpenQueue<string>();
    queue.deliver('a'); queue.deliver('b');
    const seen: string[] = [];
    queue.subscribe(value => seen.push(value));
    expect(seen).toEqual(['a', 'b']);
    queue.deliver('c');
    expect(seen).toEqual(['a', 'b', 'c']);
  });
  it('does not replay flushed values to later listeners', () => {
    const queue = createOpenQueue<number>();
    queue.deliver(1);
    queue.subscribe(() => {});
    const late: number[] = [];
    queue.subscribe(value => late.push(value));
    expect(late).toEqual([]);
  });
  it('queues again after the last listener unsubscribes', () => {
    const queue = createOpenQueue<number>();
    const seen: number[] = [];
    const stop = queue.subscribe(value => seen.push(value));
    stop();
    queue.deliver(2);
    expect(seen).toEqual([]);
    queue.subscribe(value => seen.push(value));
    expect(seen).toEqual([2]);
  });
});

describe('errorMessage', () => {
  it('passes through Tauri string rejections', () => {
    expect(errorMessage('This file is empty and cannot be opened.')).toBe('This file is empty and cannot be opened.');
  });
  it('reads Error and error-like objects', () => {
    expect(errorMessage(new Error('Access is denied.'))).toBe('Access is denied.');
    expect(errorMessage({ message: 'IPC failed' })).toBe('IPC failed');
  });
  it('falls back for empty or unknown values', () => {
    expect(errorMessage('')).toBe('The model could not be opened.');
    expect(errorMessage(undefined)).toBe('The model could not be opened.');
    expect(errorMessage(42, 'Nope.')).toBe('Nope.');
  });
});
