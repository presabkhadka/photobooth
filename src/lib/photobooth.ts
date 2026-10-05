/**
 * Shared design constants for the booth.
 *
 * Every measurement lives in "design space" (a strip is STRIP.W px wide). The
 * DOM preview scales those numbers with container query units and the canvas
 * exporter scales them by `scale`, so preview and download stay identical.
 */

export type LayoutId = 'strip' | 'grid' | 'duo'

export interface LayoutSpec {
  id: LayoutId
  label: string
  /** Design-space width of the whole frame. */
  width: number
  padding: number
  gap: number
  columns: number
  footer: number
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  strip: { id: 'strip', label: 'Classic strip', width: 620, padding: 26, gap: 14, columns: 1, footer: 146 },
  grid: { id: 'grid', label: 'Photo grid', width: 760, padding: 28, gap: 16, columns: 2, footer: 140 },
  // One row per countdown: the host's shot on the left, their partner's on the right.
  duo: { id: 'duo', label: 'Duo strip', width: 700, padding: 26, gap: 14, columns: 2, footer: 146 },
}

export const PHOTO_ASPECT = 4 / 3

/** Design-space size of a single photo for a layout. */
export function photoSize(layout: LayoutSpec) {
  const inner = layout.width - layout.padding * 2
  const width = (inner - layout.gap * (layout.columns - 1)) / layout.columns
  return { width, height: width / PHOTO_ASPECT }
}

/** Design-space height of the whole frame for a given number of slots. */
export function frameHeight(layout: LayoutSpec, slots: number) {
  const rows = Math.ceil(slots / layout.columns)
  const { height } = photoSize(layout)
  return layout.padding * 2 + rows * height + (rows - 1) * layout.gap + layout.footer
}

export interface Filter {
  id: string
  label: string
  css: string
  /** Swatch shown in the picker. */
  swatch: string
}

export const FILTERS: Filter[] = [
  {
    id: 'classic',
    label: 'Classic',
    css: 'saturate(1.05) contrast(1.03)',
    swatch: 'linear-gradient(135deg,#ffd9a8,#ff8fb1,#8fb8ff)',
  },
  {
    id: 'noir',
    label: 'Noir',
    css: 'grayscale(1) contrast(1.22) brightness(1.03)',
    swatch: 'linear-gradient(135deg,#f5f5f5,#8a8a8a,#141414)',
  },
  {
    id: 'sepia',
    label: 'Sepia',
    css: 'sepia(0.78) contrast(1.06) saturate(1.25) brightness(1.02)',
    swatch: 'linear-gradient(135deg,#f6e2bd,#c99a5b,#6b4322)',
  },
  {
    id: 'faded',
    label: 'Faded',
    css: 'sepia(0.24) saturate(1.3) contrast(0.9) brightness(1.08)',
    swatch: 'linear-gradient(135deg,#ffeede,#e7c9c0,#a9b7c4)',
  },
  {
    id: 'bubblegum',
    label: 'Bubblegum',
    css: 'saturate(1.7) hue-rotate(-12deg) brightness(1.06) contrast(1.05)',
    swatch: 'linear-gradient(135deg,#ffd0e6,#ff67a8,#ff3d6e)',
  },
  {
    id: 'frost',
    label: 'Frost',
    css: 'saturate(0.75) hue-rotate(14deg) brightness(1.12) contrast(0.96)',
    swatch: 'linear-gradient(135deg,#e6f7ff,#a7d8f0,#6f9fc8)',
  },
  {
    id: 'flare',
    label: 'Flare',
    css: 'saturate(1.35) hue-rotate(-6deg) contrast(1.12) brightness(1.04) sepia(0.12)',
    swatch: 'linear-gradient(135deg,#fff1b8,#ff9d4d,#e04f2a)',
  },
]

export interface FrameTheme {
  id: string
  label: string
  /** [top, bottom] of the frame gradient. */
  bg: [string, string]
  ink: string
  /** Muted ink for the date line. */
  sub: string
  /** Hairline drawn around each photo. */
  edge: string
}

export const THEMES: FrameTheme[] = [
  {
    id: 'cream',
    label: 'Cream',
    bg: ['#fffaf1', '#f3e7d2'],
    ink: '#221319',
    sub: 'rgba(34,19,25,0.55)',
    edge: 'rgba(34,19,25,0.14)',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    bg: ['#1b1726', '#0d0b14'],
    ink: '#f6eeff',
    sub: 'rgba(246,238,255,0.55)',
    edge: 'rgba(246,238,255,0.16)',
  },
  {
    id: 'cherry',
    label: 'Cherry',
    bg: ['#c8203f', '#7c0d22'],
    ink: '#fff1f4',
    sub: 'rgba(255,241,244,0.62)',
    edge: 'rgba(255,241,244,0.2)',
  },
  {
    id: 'butter',
    label: 'Butter',
    bg: ['#ffd977', '#f0a92f'],
    ink: '#3d2a06',
    sub: 'rgba(61,42,6,0.6)',
    edge: 'rgba(61,42,6,0.18)',
  },
  {
    id: 'mint',
    label: 'Mint',
    bg: ['#ccf5ea', '#8fd9c8'],
    ink: '#0f3b33',
    sub: 'rgba(15,59,51,0.58)',
    edge: 'rgba(15,59,51,0.16)',
  },
  {
    id: 'bubblegum',
    label: 'Bubblegum',
    bg: ['#ffd3e5', '#ff9ec4'],
    ink: '#5a1338',
    sub: 'rgba(90,19,56,0.58)',
    edge: 'rgba(90,19,56,0.16)',
  },
]

export const SHOT_OPTIONS = [3, 4] as const
export const TIMER_OPTIONS = [3, 5] as const

export function formatStripDate(date = new Date()) {
  return date
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .toUpperCase()
}

export function fileStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
