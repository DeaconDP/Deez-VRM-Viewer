export interface VirtualWindowInput {
  /** Scroll position of the scrolling container. */
  scrollTop: number;
  /** Visible height of the scrolling container. */
  viewportHeight: number;
  /** Fixed height of every row, in pixels. */
  rowHeight: number;
  /** Total number of rows in the list. */
  count: number;
  /** Extra rows rendered above and below the visible range. */
  overscan?: number;
  /** Distance from the top of the scroll content to the first row (lists nested below other content). */
  offset?: number;
}

export interface VirtualWindow {
  /** First rendered row (inclusive). */
  start: number;
  /** Last rendered row (exclusive). */
  end: number;
  /** Space above the rendered rows. */
  top: number;
  /** Space below the rendered rows. */
  bottom: number;
}

/** Rows of a fixed-height list that intersect the viewport, plus overscan; `top + rendered + bottom` always equals `count * rowHeight`. */
export function virtualWindow({ scrollTop, viewportHeight, rowHeight, count, overscan = 0, offset = 0 }: VirtualWindowInput): VirtualWindow {
  const total = Math.max(0, Math.floor(count));
  if (!total || !(rowHeight > 0)) return { start: 0, end: 0, top: 0, bottom: 0 };
  const extra = Math.max(0, Math.floor(overscan));
  const relative = scrollTop - offset, height = Math.max(0, viewportHeight);
  let first = Math.floor(relative / rowHeight), last = Math.ceil((relative + height) / rowHeight);
  if (!Number.isFinite(first) || !Number.isFinite(last)) { first = 0; last = 0; }
  // A list entirely outside the viewport (beyond overscan) renders no rows, only its spacer height.
  const start = Math.min(total, Math.max(0, first - extra));
  const end = Math.max(start, Math.min(total, Math.max(0, last + extra)));
  return { start, end, top: start * rowHeight, bottom: (total - end) * rowHeight };
}
