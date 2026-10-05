import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Link2,
  Loader2,
  LogIn,
  Share2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DuoStatus } from '@/hooks/use-duo'
import { CODE_LENGTH, parseBoothCode } from '@/lib/duo-protocol'
import { cn } from '@/lib/utils'

type Mode = 'menu' | 'invite' | 'join'

export interface DuoDialogProps {
  open: boolean
  status: DuoStatus
  code: string | null
  inviteUrl: string | null
  isHost: boolean
  error: string | null
  cameraReady: boolean
  /** Code lifted from a ?booth= link, if the visitor arrived through one. */
  initialCode: string | null
  onClose: () => void
  onStartCamera: () => void
  onInvite: () => void
  onJoin: (code: string) => void
  onLeave: () => void
}

function Bulbs({ count = 12 }: { count?: number }) {
  return (
    <span aria-hidden className="flex justify-between">
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className="size-1.5 rounded-full bg-gold-400 animate-bulb"
          style={{ animationDelay: `${(index % 6) * 0.2}s` }}
        />
      ))}
    </span>
  )
}

export function DuoDialog({
  open,
  status,
  code,
  inviteUrl,
  isHost,
  error,
  cameraReady,
  initialCode,
  onClose,
  onStartCamera,
  onInvite,
  onJoin,
  onLeave,
}: DuoDialogProps) {
  const [mode, setMode] = useState<Mode>('menu')
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  /** Prefill from the invite link once per opening, never mid-typing. */
  const primedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      primedRef.current = false
      return
    }
    if (primedRef.current) return
    primedRef.current = true

    setLocalError(null)
    setCopied(false)
    if (initialCode) {
      setMode('join')
      setInput(initialCode)
    } else if (status === 'off' || status === 'error') {
      setMode('menu')
    }
  }, [initialCode, open, status])

  useEffect(() => {
    if (status === 'waiting' && isHost) setMode('invite')
  }, [isHost, status])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  if (!open) return null

  const busy = status === 'connecting' || status === 'linking'

  const handleCopy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setLocalError('Your browser blocked the clipboard — select the link and copy it by hand.')
    }
  }

  const handleShare = async () => {
    if (!inviteUrl) return
    try {
      await navigator.share({
        title: 'Join my photo booth',
        text: 'Get in the booth with me 📸',
        url: inviteUrl,
      })
    } catch {
      // Cancelled — nothing to do.
    }
  }

  const handleLeave = () => {
    onLeave()
    setMode('menu')
    setLocalError(null)
  }

  const handleJoin = () => {
    const parsed = parseBoothCode(input)
    if (!parsed) {
      setLocalError('That does not look like a booth code or invite link.')
      return
    }
    setLocalError(null)
    onJoin(parsed)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Collaborative shots"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md animate-drop rounded-[28px] border-2 border-gold-600/60 bg-gradient-to-b from-curtain-700 to-curtain-900 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] sm:p-5">
        <div className="mb-3 px-2">
          <Bulbs />
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid size-9 place-items-center rounded-full bg-black/40 text-cream/70 transition hover:bg-black/70 hover:text-gold-400"
        >
          <X className="size-4" />
        </button>

        <div className="rounded-[18px] bg-black/40 p-5 ring-1 ring-gold-600/25 sm:p-6">
          {mode !== 'menu' && (status === 'off' || status === 'error') && (
            <button
              type="button"
              onClick={() => setMode('menu')}
              className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-cream/55 uppercase transition hover:text-gold-400"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
          )}

          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-black/40 px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-gold-400 uppercase">
              <Users className="size-3" /> Two-person booth
            </span>

            <h2 className="mt-3 text-marquee text-2xl sm:text-3xl">
              {mode === 'menu'
                ? 'Collaborative shots'
                : mode === 'invite'
                  ? 'Your booth is open'
                  : 'Join a booth'}
            </h2>

            <p className="mx-auto mt-2 max-w-xs text-sm text-cream/65">
              {mode === 'menu'
                ? 'Two cameras, one countdown. Every shot prints side by side on the same strip.'
                : mode === 'invite'
                  ? 'Send this link. The moment they open it, you both shoot together.'
                  : 'Paste the invite link, or type the six-character code.'}
            </p>
          </div>

          {!cameraReady && (
            <div className="mt-5 rounded-2xl border border-neon-pink/40 bg-neon-pink/10 p-4 text-center">
              <p className="text-sm text-cream/80">
                Your camera needs to be on before you can share a booth.
              </p>
              <Button size="sm" className="mt-3" onClick={onStartCamera}>
                <Camera className="size-4" /> Turn on camera
              </Button>
            </div>
          )}

          {mode === 'menu' && (
            <div className="mt-6 grid gap-3">
              <button
                type="button"
                disabled={!cameraReady}
                onClick={onInvite}
                className="group flex items-center gap-4 rounded-2xl border border-cream/15 bg-black/30 p-4 text-left transition-all duration-200 hover:border-gold-400/70 hover:bg-cream/5 disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-gold-400 to-gold-600 text-ink">
                  <Link2 className="size-5" />
                </span>
                <span>
                  <span className="block font-display text-sm text-cream">Invite someone</span>
                  <span className="mt-0.5 block text-xs text-cream/55">
                    Get a link to send them
                  </span>
                </span>
              </button>

              <button
                type="button"
                disabled={!cameraReady}
                onClick={() => setMode('join')}
                className="group flex items-center gap-4 rounded-2xl border border-cream/15 bg-black/30 p-4 text-left transition-all duration-200 hover:border-neon-pink/70 hover:bg-cream/5 disabled:pointer-events-none disabled:opacity-40"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-b from-neon-pink to-[#d92e6c] text-white">
                  <LogIn className="size-5" />
                </span>
                <span>
                  <span className="block font-display text-sm text-cream">Join a booth</span>
                  <span className="mt-0.5 block text-xs text-cream/55">
                    Someone already sent you one
                  </span>
                </span>
              </button>
            </div>
          )}

          {mode === 'invite' && (
            <div className="mt-6">
              <div className="rounded-2xl border border-gold-500/30 bg-black/40 p-4 text-center">
                <span className="text-[10px] font-semibold tracking-[0.24em] text-cream/45 uppercase">
                  Booth code
                </span>
                <p className="mt-1 font-display text-3xl tracking-[0.28em] text-gold-400 sm:text-4xl">
                  {code ?? '······'}
                </p>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl ?? ''}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 min-w-0 flex-1 rounded-full border border-cream/15 bg-black/40 px-4 text-xs text-cream/80 focus:border-gold-400/70 focus:outline-none"
                />
                <Button size="icon" onClick={() => void handleCopy()} aria-label="Copy invite link">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => void handleShare()}
                    aria-label="Share invite link"
                  >
                    <Share2 className="size-4" />
                  </Button>
                )}
              </div>

              <div className="mt-5 flex items-center justify-center gap-2.5 text-sm text-cream/60">
                <Loader2 className="size-4 animate-spin text-gold-400" />
                {status === 'linking' ? 'Connecting you two…' : 'Waiting for them to arrive…'}
              </div>

              <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={handleLeave}>
                Cancel invite
              </Button>
            </div>
          )}

          {mode === 'join' && (
            <div className="mt-6">
              <input
                autoFocus
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleJoin()}
                placeholder="Paste link or code"
                maxLength={200}
                className={cn(
                  'h-12 w-full rounded-full border border-cream/15 bg-black/40 px-5 text-center font-display text-lg tracking-[0.18em] text-cream uppercase placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:normal-case placeholder:text-cream/35 focus:border-gold-400/70 focus:outline-none',
                  input.length > CODE_LENGTH && 'text-xs tracking-normal',
                )}
              />

              <Button
                size="lg"
                className="mt-3 w-full"
                disabled={!cameraReady || busy || !input.trim()}
                onClick={handleJoin}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                {busy ? 'Connecting…' : 'Step into the booth'}
              </Button>

              {status === 'waiting' && !isHost && (
                <p className="mt-4 text-center text-sm text-cream/60">
                  You are in booth {code}. Waiting for your partner…
                </p>
              )}
            </div>
          )}

          {(error ?? localError) && (
            <p className="mt-4 text-center text-sm text-neon-pink">{error ?? localError}</p>
          )}
        </div>

        <div className="mt-3 px-2">
          <Bulbs />
        </div>
      </div>
    </div>
  )
}
