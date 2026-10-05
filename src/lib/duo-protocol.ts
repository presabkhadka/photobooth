/** Wire format for the peer-to-peer booth link. */

export interface SharedStyle {
  filterId: string
  themeId: string
  caption: string
  grain: boolean
  /** Only the host sends these — they drive the countdown. */
  shots?: number
  timer?: number
}

export type DuoMessage =
  | { t: 'hello'; cameraReady: boolean }
  | { t: 'camera'; ready: boolean }
  | { t: 'style'; style: SharedStyle }
  | { t: 'go'; shots: number; timer: number }
  | { t: 'stop' }
  /** Low-rate stand-in for live video when the session is running over the relay. */
  | { t: 'preview'; frame: string }
  /** Assembled by the transport before it reaches the app. */
  | { t: 'photo'; round: number; dataUrl: string }

/** Chunk envelopes never surface to the app — the hook reassembles them. */
export type WireMessage =
  | DuoMessage
  | { t: 'photo-start'; id: string; round: number; chunks: number }
  | { t: 'photo-chunk'; id: string; index: number; body: string }
  | { t: 'photo-end'; id: string }

/** SCTP tops out around 256KB per message; 16KB keeps every browser happy. */
export const CHUNK_SIZE = 16 * 1024
export const BUFFER_LIMIT = 512 * 1024
export const BUFFER_LOW = 128 * 1024

/** Splits a photo into channel-sized slices. Rejoining them must be lossless. */
export function planChunks(dataUrl: string) {
  const parts: string[] = []
  for (let index = 0; index < dataUrl.length; index += CHUNK_SIZE) {
    parts.push(dataUrl.slice(index, index + CHUNK_SIZE))
  }
  return parts
}

/**
 * Reassembles chunked photos. Both transports deliver in order, but slots are
 * filled by index so a reordered delivery still rebuilds correctly.
 */
export class PhotoInbox {
  private entries = new Map<string, { round: number; parts: string[] }>()

  start(id: string, round: number, chunks: number) {
    this.entries.set(id, { round, parts: new Array<string>(chunks).fill('') })
  }

  chunk(id: string, index: number, body: string) {
    const entry = this.entries.get(id)
    if (entry && index >= 0 && index < entry.parts.length) entry.parts[index] = body
  }

  /** Returns the finished photo, or null if this id was never started. */
  end(id: string) {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    return entry ? { round: entry.round, dataUrl: entry.parts.join('') } : null
  }

  clear() {
    this.entries.clear()
  }
}

/** Unambiguous alphabet — no O/0, no I/1, so codes survive being read aloud. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LENGTH = 6

export function createBoothCode() {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

/** Accepts a raw code, a pasted invite URL, or something in between. */
export function parseBoothCode(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return null

  let candidate = trimmed
  try {
    const url = new URL(trimmed)
    candidate = url.searchParams.get('booth') ?? url.hash.replace('#', '') ?? ''
  } catch {
    // Not a URL — treat it as a bare code.
  }

  const code = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length >= 4 ? code.slice(0, 8) : null
}

export function boothInviteUrl(code: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('booth', code)
  return url.toString()
}

/** Which strip slot a given round belongs to. Host takes the left column. */
export function slotFor(round: number, host: boolean) {
  return round * 2 + (host ? 0 : 1)
}
