import { describe, expect, it } from 'vitest';
import { virtualWindow } from './virtualWindow';

const ROW = 31;

describe('virtualWindow', () => {
  it('renders the visible rows plus overscan at the top of a list', () => {
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 310, rowHeight: ROW, count: 10000, overscan: 5 })).toEqual({ start: 0, end: 15, top: 0, bottom: (10000 - 15) * ROW });
  });

  it('windows the middle of a long list and keeps the total height', () => {
    const w = virtualWindow({ scrollTop: 100 * ROW + 10, viewportHeight: 300, rowHeight: ROW, count: 10000, overscan: 4 });
    expect(w).toEqual({ start: 96, end: 114, top: 96 * ROW, bottom: (10000 - 114) * ROW });
    expect(w.top + (w.end - w.start) * ROW + w.bottom).toBe(10000 * ROW);
  });

  it('clamps at the end of the list', () => {
    expect(virtualWindow({ scrollTop: 9990 * ROW, viewportHeight: 1000, rowHeight: ROW, count: 10000, overscan: 8 })).toEqual({ start: 9982, end: 10000, top: 9982 * ROW, bottom: 0 });
  });

  it('accounts for the list offset inside a shared scroll container', () => {
    // List starts 500px down; viewport shows 0..400 → no rows rendered, just the spacer.
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: ROW, count: 100, overscan: 3, offset: 500 })).toEqual({ start: 0, end: 0, top: 0, bottom: 100 * ROW });
    // Viewport 0..600 shows the first 100px of the list (rows 0..3).
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 600, rowHeight: ROW, count: 100, overscan: 2, offset: 500 })).toEqual({ start: 0, end: 6, top: 0, bottom: 94 * ROW });
    // Scrolled well past the list: nothing rendered, full height kept above.
    expect(virtualWindow({ scrollTop: 10000, viewportHeight: 400, rowHeight: ROW, count: 100, overscan: 3, offset: 0 })).toEqual({ start: 100, end: 100, top: 100 * ROW, bottom: 0 });
    // Just past the end: overscan keeps the last rows mounted.
    expect(virtualWindow({ scrollTop: 100 * ROW + 40, viewportHeight: 400, rowHeight: ROW, count: 100, overscan: 3 })).toEqual({ start: 98, end: 100, top: 98 * ROW, bottom: 0 });
  });

  it('renders short lists in full', () => {
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 800, rowHeight: ROW, count: 12, overscan: 10 })).toEqual({ start: 0, end: 12, top: 0, bottom: 0 });
  });

  it('handles empty lists and degenerate input', () => {
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 500, rowHeight: ROW, count: 0, overscan: 5 })).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
    expect(virtualWindow({ scrollTop: 0, viewportHeight: 500, rowHeight: 0, count: 50 })).toEqual({ start: 0, end: 0, top: 0, bottom: 0 });
    expect(virtualWindow({ scrollTop: -40, viewportHeight: 0, rowHeight: ROW, count: 50, overscan: 1 })).toEqual({ start: 0, end: 0, top: 0, bottom: 50 * ROW });
    expect(virtualWindow({ scrollTop: NaN, viewportHeight: 300, rowHeight: ROW, count: 50 })).toEqual({ start: 0, end: 0, top: 0, bottom: 50 * ROW });
  });
});
