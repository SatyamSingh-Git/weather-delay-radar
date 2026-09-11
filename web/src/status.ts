/**
 * The reserved status palette. Each entry ships a glyph and a label alongside its
 * colour, so status is never carried by hue alone.
 */
export const STATUS = {
  onTime: { color: 'var(--status-good)', glyph: '●', label: 'ON TIME' },
  delayed: { color: 'var(--status-warning)', glyph: '▲', label: 'DELAYED' },
  failed: { color: 'var(--status-critical)', glyph: '■', label: 'FAILED' },
} as const;

export type StatusKey = keyof typeof STATUS;
