/**
 * Canvas filtering.
 *
 * `ctx.filter` handles this in every modern browser, but older Safari silently
 * ignores it — which would ship a downloaded strip that doesn't match the
 * preview. The fallback re-implements exactly the CSS filter functions used in
 * `FILTERS` (grayscale, sepia, saturate, hue-rotate, brightness, contrast) over
 * raw pixels so both paths produce the same picture.
 */

let filterSupport: boolean | null = null

export function supportsCanvasFilter() {
  if (filterSupport !== null) return filterSupport
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return (filterSupport = false)
  ctx.filter = 'grayscale(1)'
  return (filterSupport = ctx.filter === 'grayscale(1)')
}

type Matrix = [number, number, number, number, number, number, number, number, number]

interface Op {
  matrix?: Matrix
  /** value -> value * scale + offset, applied per channel. */
  linear?: { scale: number; offset: number }
}

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const LUMA = [0.2126, 0.7152, 0.0722] as const

function lerpMatrix(target: Matrix, amount: number): Matrix {
  return IDENTITY.map((id, i) => id + (target[i] - id) * amount) as Matrix
}

function parseAmount(raw: string, fallback = 1) {
  const value = raw.trim()
  if (!value) return fallback
  if (value.endsWith('%')) return parseFloat(value) / 100
  if (value.endsWith('deg')) return parseFloat(value)
  if (value.endsWith('turn')) return parseFloat(value) * 360
  if (value.endsWith('rad')) return (parseFloat(value) * 180) / Math.PI
  return parseFloat(value)
}

function toOps(filter: string): Op[] {
  const ops: Op[] = []
  const re = /([a-z-]+)\(([^)]*)\)/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(filter))) {
    const name = match[1].toLowerCase()
    const arg = match[2]

    switch (name) {
      case 'grayscale': {
        const a = Math.min(1, Math.max(0, parseAmount(arg)))
        ops.push({
          matrix: lerpMatrix(
            [LUMA[0], LUMA[1], LUMA[2], LUMA[0], LUMA[1], LUMA[2], LUMA[0], LUMA[1], LUMA[2]],
            a,
          ),
        })
        break
      }
      case 'sepia': {
        const a = Math.min(1, Math.max(0, parseAmount(arg)))
        ops.push({
          matrix: lerpMatrix(
            [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
            a,
          ),
        })
        break
      }
      case 'saturate': {
        const s = Math.max(0, parseAmount(arg))
        ops.push({
          matrix: [
            LUMA[0] + (1 - LUMA[0]) * s, LUMA[1] * (1 - s), LUMA[2] * (1 - s),
            LUMA[0] * (1 - s), LUMA[1] + (1 - LUMA[1]) * s, LUMA[2] * (1 - s),
            LUMA[0] * (1 - s), LUMA[1] * (1 - s), LUMA[2] + (1 - LUMA[2]) * s,
          ],
        })
        break
      }
      case 'hue-rotate': {
        const rad = (parseAmount(arg, 0) * Math.PI) / 180
        const c = Math.cos(rad)
        const s = Math.sin(rad)
        ops.push({
          matrix: [
            0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
          ],
        })
        break
      }
      case 'brightness': {
        const b = Math.max(0, parseAmount(arg))
        ops.push({ linear: { scale: b, offset: 0 } })
        break
      }
      case 'contrast': {
        const c = Math.max(0, parseAmount(arg))
        ops.push({ linear: { scale: c, offset: (0.5 - 0.5 * c) * 255 } })
        break
      }
      default:
        break
    }
  }

  return ops
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Applies a CSS filter string to a canvas region, pixel by pixel. */
export function applyFilterFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filter: string,
) {
  const ops = toOps(filter)
  if (!ops.length || w <= 0 || h <= 0) return

  const image = ctx.getImageData(x, y, w, h)
  const data = image.data

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    for (const op of ops) {
      if (op.matrix) {
        const m = op.matrix
        const nr = r * m[0] + g * m[1] + b * m[2]
        const ng = r * m[3] + g * m[4] + b * m[5]
        const nb = r * m[6] + g * m[7] + b * m[8]
        r = nr
        g = ng
        b = nb
      } else if (op.linear) {
        r = r * op.linear.scale + op.linear.offset
        g = g * op.linear.scale + op.linear.offset
        b = b * op.linear.scale + op.linear.offset
      }
    }

    data[i] = clamp(r)
    data[i + 1] = clamp(g)
    data[i + 2] = clamp(b)
  }

  ctx.putImageData(image, x, y)
}
