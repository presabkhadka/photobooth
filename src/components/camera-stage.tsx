import {
  Camera,
  CameraOff,
  ImageUp,
  Loader2,
  RefreshCcw,
  SwitchCamera,
  Users,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

import { MarqueeFrame } from '@/components/marquee-frame'
import { Button } from '@/components/ui/button'
import type { CameraStatus } from '@/hooks/use-camera'
import { cn } from '@/lib/utils'

export interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  status: CameraStatus
  message: string
  filter: string
  mirror: boolean
  grain: boolean
  canSwitch: boolean
  countdown: number | null
  flash: boolean
  freeze: string | null
  shotNumber: number
  totalShots: number
  isRunning: boolean
  /** Split the stage in two once a partner is in the booth. */
  duoActive: boolean
  remoteStream: MediaStream | null
  remotePreview: string | null
  relaying: boolean
  onStartCamera: () => void
  onFlip: () => void
  onUpload: () => void
}

function TileLabel({ children, tone }: { children: ReactNode; tone: 'gold' | 'pink' }) {
  return (
    <span
      className={cn(
        'absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase backdrop-blur-sm',
        tone === 'gold' ? 'bg-black/60 text-gold-400' : 'bg-black/60 text-neon-pink',
      )}
    >
      {children}
    </span>
  )
}

function RemoteTile({
  stream,
  preview,
  filter,
  grain,
}: {
  stream: MediaStream | null
  /** Still frame stand-in used while the session is relayed. */
  preview: string | null
  filter: string
  grain: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      if (stream) void video.play().catch(() => undefined)
    }
  }, [stream])

  const showing = Boolean(stream || preview)

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-black/70">
      {stream ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
          style={{ filter }}
        />
      ) : preview ? (
        <img src={preview} alt="Your partner" className="size-full object-cover" style={{ filter }} />
      ) : null}

      {grain && showing && (
        <div className="pointer-events-none absolute inset-0 grain-overlay opacity-[0.14] mix-blend-overlay" />
      )}

      {!showing && (
        <div className="absolute inset-0 grid place-items-center px-3 text-center">
          <div>
            <Loader2 className="mx-auto size-6 animate-spin text-neon-pink" />
            <p className="mt-2 text-[11px] text-cream/60">Waiting for their camera…</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
      <TileLabel tone="pink">Them</TileLabel>
    </div>
  )
}

export function CameraStage({
  videoRef,
  stream,
  status,
  message,
  filter,
  mirror,
  grain,
  canSwitch,
  countdown,
  flash,
  freeze,
  shotNumber,
  totalShots,
  isRunning,
  duoActive,
  remoteStream,
  remotePreview,
  relaying,
  onStartCamera,
  onFlip,
  onUpload,
}: CameraStageProps) {
  const live = status === 'ready'

  // The element moves in the tree when the stage splits, so re-attach the feed.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
      void video.play().catch(() => undefined)
    }
  }, [duoActive, stream, videoRef])

  const localVideo = (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      className={cn(
        'size-full object-cover transition-opacity duration-500',
        live ? 'opacity-100' : 'opacity-0',
      )}
      style={{ filter, transform: mirror ? 'scaleX(-1)' : undefined }}
    />
  )

  const localGrain = grain && (
    <div className="pointer-events-none absolute inset-0 grain-overlay opacity-[0.14] mix-blend-overlay" />
  )

  const localFreeze = freeze && (
    <img
      src={freeze}
      alt=""
      className="absolute inset-0 size-full animate-pop object-cover"
      style={{ filter }}
    />
  )

  return (
    <MarqueeFrame>
      <div className="relative w-full overflow-hidden bg-[#120a10]">
        {duoActive ? (
          <div className="grid grid-cols-2 gap-1.5 p-1.5">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-black/70">
              {localVideo}
              {localGrain}
              {localFreeze}
              <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]" />
              <TileLabel tone="gold">You</TileLabel>
            </div>
            <RemoteTile
              stream={remoteStream}
              preview={remotePreview}
              filter={filter}
              grain={grain}
            />
          </div>
        ) : (
          <div className="relative aspect-[4/3] w-full">
            {localVideo}
            {localGrain}
            {localFreeze}
          </div>
        )}

        {/* Booth glass: soft top light + corner falloff */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-20%,rgba(255,240,200,0.22),transparent_55%)]" />
        {!duoActive && (
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_90px_rgba(0,0,0,0.55)]" />
        )}

        {/* Shutter flash */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-white transition-opacity',
            flash ? 'opacity-90 duration-75' : 'opacity-0 duration-500',
          )}
        />

        {/* Countdown */}
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
            <span
              key={countdown}
              className={cn(
                'animate-pop text-marquee leading-none',
                duoActive ? 'text-[14vw] sm:text-[6rem]' : 'text-[22vw] sm:text-[8rem]',
              )}
            >
              {countdown}
            </span>
          </div>
        )}

        {/* Status strip */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 text-[10px] font-semibold tracking-[0.2em] uppercase sm:p-4 sm:text-xs">
          <span className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm">
            <span
              className={cn(
                'size-2 rounded-full',
                isRunning ? 'bg-neon-pink animate-bulb' : live ? 'bg-neon-mint' : 'bg-cream/40',
              )}
            />
            {isRunning ? 'Rolling' : live ? 'Ready' : 'Standby'}
          </span>

          <span className="flex items-center gap-2">
            {duoActive && (
              <span className="flex items-center gap-1.5 rounded-full bg-neon-pink/25 px-3 py-1.5 text-neon-pink backdrop-blur-sm">
                <Users className="size-3" /> {relaying ? 'Linked · relay' : 'Linked'}
              </span>
            )}
            <span className="rounded-full bg-black/55 px-3 py-1.5 text-gold-400 backdrop-blur-sm">
              Shot {Math.min(shotNumber, totalShots)} / {totalShots}
            </span>
          </span>
        </div>

        {/* Camera flip */}
        {live && canSwitch && !isRunning && (
          <button
            type="button"
            onClick={onFlip}
            aria-label="Switch camera"
            className="absolute right-3 bottom-3 grid size-11 place-items-center rounded-full bg-black/60 text-cream backdrop-blur-sm transition hover:bg-black/80 hover:text-gold-400 sm:right-4 sm:bottom-4"
          >
            <SwitchCamera className="size-5" />
          </button>
        )}

        {/* Pre-flight / error panel */}
        {!live && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div className="max-w-sm">
              {status === 'starting' ? (
                <Loader2 className="mx-auto mb-4 size-10 animate-spin text-gold-400" />
              ) : status === 'idle' ? (
                <Camera className="mx-auto mb-4 size-10 text-gold-400" />
              ) : (
                <CameraOff className="mx-auto mb-4 size-10 text-neon-pink" />
              )}

              <h2 className="text-marquee text-lg sm:text-xl">
                {status === 'starting'
                  ? 'Warming up…'
                  : status === 'idle'
                    ? 'Step inside'
                    : 'No camera'}
              </h2>

              <p className="mt-2 text-sm text-cream/70">
                {status === 'idle'
                  ? 'Turn the camera on, strike a pose, and the booth handles the rest.'
                  : status === 'starting'
                    ? 'Asking your browser nicely for the camera.'
                    : message}
              </p>

              {status !== 'starting' && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={onStartCamera} size="md">
                    {status === 'idle' ? (
                      <>
                        <Camera className="size-4" /> Turn on camera
                      </>
                    ) : (
                      <>
                        <RefreshCcw className="size-4" /> Try again
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="md" onClick={onUpload}>
                    <ImageUp className="size-4" /> Use photos instead
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </MarqueeFrame>
  )
}
