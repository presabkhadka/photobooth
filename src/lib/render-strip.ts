import { applyFilterFallback, supportsCanvasFilter } from '@/lib/image-filter'
import {
  LAYOUTS,
  frameHeight,
  photoSize,
  type FrameTheme,
  type LayoutId,
} from '@/lib/photobooth'

export interface StripRenderOptions {
  /** Slots may be empty while a partner's shots are still in flight. */
  photos: (string | null | undefined)[]
  layout: LayoutId
  theme: FrameTheme
  filter: string
  caption: string
  date: string
  grain: boolean
  /** Multiplier over design space. 2 gives a crisp, printable export. */
  scale?: number
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load a photo'))
    img.src = src
  })
}

/** Draws `img` filling the box, cropping the overflowing axis. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const target = w / h
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height

  if (img.width / img.height > target) {
    sw = img.height * target
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / target
    sy = (img.height - sh) / 2
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/** Deterministic noise so re-renders of the same strip look identical. */
function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  let seed = 0x2f6e2b1

  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = ((seed >>> 16) / 65535 - 0.5) * amount
    data[i] = Math.min(255, Math.max(0, data[i] + noise))
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise))
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise))
  }

  ctx.putImageData(image, 0, 0)
}

let fontsPromise: Promise<unknown> | null = null

/** Canvas silently falls back to a default face if the webfont isn't parsed yet. */
function ensureFonts() {
  if (!fontsPromise) {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    fontsPromise = fonts
      ? Promise.all([
          fonts.load('700 46px Caveat'),
          fonts.load('600 19px "Space Grotesk"'),
          fonts.load('400 16px Bungee'),
        ]).catch(() => undefined)
      : Promise.resolve()
  }
  return fontsPromise
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  // Not in every browser's 2D context typings, and a no-op where unsupported.
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = value
}

export async function renderStrip(options: StripRenderOptions): Promise<HTMLCanvasElement> {
  const { photos, theme, filter, caption, date, grain } = options
  const scale = options.scale ?? 2
  const layout = LAYOUTS[options.layout]
  const slots = photos.length
  const { width: pw, height: ph } = photoSize(layout)
  const height = frameHeight(layout, slots)

  const [images] = await Promise.all([
    Promise.all(photos.map((photo) => (photo ? loadImage(photo) : Promise.resolve(null)))),
    ensureFonts(),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(layout.width * scale)
  canvas.height = Math.round(height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser')

  ctx.scale(scale, scale)
  ctx.textBaseline = 'alphabetic'

  // Frame
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, theme.bg[0])
  bg.addColorStop(1, theme.bg[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, layout.width, height)

  const canFilter = supportsCanvasFilter()

  images.forEach((img, index) => {
    const col = index % layout.columns
    const row = Math.floor(index / layout.columns)
    const x = layout.padding + col * (pw + layout.gap)
    const y = layout.padding + row * (ph + layout.gap)

    if (!img) {
      ctx.fillStyle = theme.edge
      ctx.fillRect(x, y, pw, ph)
      return
    }

    if (canFilter) ctx.filter = filter
    drawCover(ctx, img, x, y, pw, ph)
    ctx.filter = 'none'

    if (!canFilter) {
      applyFilterFallback(
        ctx,
        Math.round(x * scale),
        Math.round(y * scale),
        Math.round(pw * scale),
        Math.round(ph * scale),
        filter,
      )
    }

    // Corner falloff, so photos read as prints rather than flat crops.
    const vignette = ctx.createRadialGradient(
      x + pw / 2,
      y + ph / 2,
      Math.min(pw, ph) * 0.32,
      x + pw / 2,
      y + ph / 2,
      Math.max(pw, ph) * 0.72,
    )
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,0.22)')
    ctx.fillStyle = vignette
    ctx.fillRect(x, y, pw, ph)

    ctx.strokeStyle = theme.edge
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1)
  })

  // Footer
  const rows = Math.ceil(slots / layout.columns)
  const footerTop = layout.padding + rows * ph + (rows - 1) * layout.gap
  const centerX = layout.width / 2
  const trimmed = caption.trim()

  ctx.textAlign = 'center'

  if (trimmed) {
    ctx.fillStyle = theme.ink
    ctx.font = '700 46px Caveat, cursive'
    ctx.fillText(trimmed, centerX, footerTop + 58, layout.width - layout.padding * 2)
  }

  ctx.fillStyle = theme.sub
  ctx.font = '600 19px "Space Grotesk", sans-serif'
  setLetterSpacing(ctx, '3px')
  ctx.fillText(date, centerX, footerTop + (trimmed ? 96 : 58))

  ctx.font = '400 15px Bungee, sans-serif'
  ctx.globalAlpha = 0.55
  setLetterSpacing(ctx, '2px')
  ctx.fillText('★ PHOTOBOOTH ★', centerX, footerTop + (trimmed ? 128 : 92))
  ctx.globalAlpha = 1
  setLetterSpacing(ctx, '0px')

  if (grain) addGrain(ctx, canvas.width, canvas.height, 22)

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png') {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the strip'))
    }, type)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give Safari a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
