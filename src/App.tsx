import {
  Aperture,
  Download,
  FlipHorizontal2,
  Link2,
  Loader2,
  LogOut,
  RotateCcw,
  Share2,
  Sparkles,
  Square,
  Users,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BoothBackdrop } from '@/components/booth-backdrop'
import { CameraStage } from '@/components/camera-stage'
import { Field, Panel, Segmented, SwatchGroup, Toggle } from '@/components/controls'
import { DuoDialog } from '@/components/duo-dialog'
import { PhotoStrip } from '@/components/photo-strip'
import { Button } from '@/components/ui/button'
import { useCamera } from '@/hooks/use-camera'
import { useDuo } from '@/hooks/use-duo'
import { useSound } from '@/hooks/use-sound'
import { slotFor, type DuoMessage, type SharedStyle } from '@/lib/duo-protocol'
import {
  FILTERS,
  SHOT_OPTIONS,
  THEMES,
  TIMER_OPTIONS,
  fileStamp,
  formatStripDate,
  type LayoutId,
} from '@/lib/photobooth'
import { canvasToBlob, downloadBlob, renderStrip } from '@/lib/render-strip'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'running' | 'developing' | 'done'

interface SessionConfig {
  shots: number
  timer: number
  duo: boolean
}

const CAPTURE_WIDTH = 1280
const CAPTURE_HEIGHT = 960
/** How long to wait for a partner's shots before printing what we have. */
const DEVELOP_TIMEOUT = 20_000

/** Center-crops an uploaded file to the booth's 4:3 frame. */
function fileToPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = CAPTURE_WIDTH
      canvas.height = CAPTURE_HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas is unavailable'))

      const target = CAPTURE_WIDTH / CAPTURE_HEIGHT
      let sx = 0
      let sy = 0
      let sw = img.width
      let sh = img.height
      if (sw / sh > target) {
        sw = sh * target
        sx = (img.width - sw) / 2
      } else {
        sh = sw / target
        sy = (img.height - sh) / 2
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not read ${file.name}`))
    }

    img.src = url
  })
}

export default function App() {
  const camera = useCamera()

  const [shots, setShots] = useState<number>(4)
  const [timer, setTimer] = useState<number>(3)
  const [layout, setLayout] = useState<LayoutId>('strip')
  const [filterId, setFilterId] = useState(FILTERS[0].id)
  const [themeId, setThemeId] = useState(THEMES[0].id)
  const [caption, setCaption] = useState('')
  const [grain, setGrain] = useState(true)
  const [mirror, setMirror] = useState(true)
  const [soundOn, setSoundOn] = useState(true)

  const [photos, setPhotos] = useState<(string | null)[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)
  const [freeze, setFreeze] = useState<string | null>(null)
  const [stripDate, setStripDate] = useState(() => formatStripDate())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [duoOpen, setDuoOpen] = useState(false)

  const [inviteCode] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('booth'),
  )

  const sound = useSound(soundOn)
  const cancelRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** Lets an incoming "go" start a session that is defined further down. */
  const runSessionRef = useRef<(config: SessionConfig) => void>(() => { })
  const hostRef = useRef(false)
  const mirrorRef = useRef(mirror)
  const styleRef = useRef<SharedStyle>({ filterId, themeId, caption, grain })

  const filter = useMemo(() => FILTERS.find((f) => f.id === filterId) ?? FILTERS[0], [filterId])
  const theme = useMemo(() => THEMES.find((t) => t.id === themeId) ?? THEMES[0], [themeId])

  const isRunning = phase === 'running'
  const isBusy = phase === 'running' || phase === 'developing'
  const hasStrip = phase === 'done' && photos.some(Boolean)

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(resolve, ms)
        timersRef.current.push(id)
      }),
    [],
  )

  const resetSession = useCallback(() => {
    cancelRef.current = true
    setPhase('idle')
    setCountdown(null)
    setFreeze(null)
    setFlash(false)
    setPhotos([])
  }, [])

  const handleDuoMessage = useCallback(
    (message: DuoMessage) => {
      switch (message.t) {
        case 'hello':
          setNotice('Your partner stepped into the booth.')
          break

        case 'go':
          setShots(message.shots)
          setTimer(message.timer)
          setLayout('duo')
          runSessionRef.current({ shots: message.shots, timer: message.timer, duo: true })
          break

        case 'photo':
          setPhotos((prev) => {
            const next = [...prev]
            next[slotFor(message.round, !hostRef.current)] = message.dataUrl
            return next
          })
          break

        case 'style':
          setFilterId(message.style.filterId)
          setThemeId(message.style.themeId)
          setCaption(message.style.caption)
          setGrain(message.style.grain)
          if (message.style.shots) setShots(message.style.shots)
          if (message.style.timer) setTimer(message.style.timer)
          break

        case 'stop':
          setNotice('Your partner stopped the booth.')
          resetSession()
          break

        default:
          break
      }
    },
    [resetSession],
  )

  const duo = useDuo({
    localStream: camera.stream,
    snapshot: () => camera.snapshot(mirrorRef.current),
    onMessage: handleDuoMessage,
    onNotice: setNotice,
  })

  hostRef.current = duo.isHost
  mirrorRef.current = mirror
  styleRef.current = { filterId, themeId, caption, grain }

  const duoLive = duo.status === 'live'
  const duoActive = duoLive || duo.status === 'linking'
  const relaying = duo.transport === 'relay'
  const canDrive = !duoLive || duo.isHost

  const runSession = useCallback(
    async (config: SessionConfig) => {
      if (camera.status !== 'ready' || isBusy) return

      sound.unlock()
      cancelRef.current = false
      setPhotos(new Array(config.duo ? config.shots * 2 : config.shots).fill(null))
      setFreeze(null)
      setPhase('running')

      for (let round = 0; round < config.shots; round++) {
        for (let n = config.timer; n > 0; n--) {
          setCountdown(n)
          if (n === 1) sound.ding()
          else sound.tick()
          await sleep(1000)
          if (cancelRef.current) return
        }

        setCountdown(null)
        const frame = camera.capture(mirror)
        sound.shutter()
        setFlash(true)
        await sleep(110)
        setFlash(false)

        if (!frame) {
          setNotice('The camera dropped out mid-shot. Give it another go.')
          resetSession()
          return
        }

        const slot = config.duo ? slotFor(round, hostRef.current) : round
        setPhotos((prev) => {
          const next = [...prev]
          next[slot] = frame
          return next
        })
        if (config.duo) void duo.sendPhoto(round, frame)

        setFreeze(frame)
        await sleep(850)
        if (cancelRef.current) return
        setFreeze(null)
        await sleep(300)
        if (cancelRef.current) return
      }

      setStripDate(formatStripDate())
      setPhase(config.duo ? 'developing' : 'done')
    },
    [camera, duo, isBusy, mirror, resetSession, sleep, sound],
  )

  runSessionRef.current = (config) => void runSession(config)

  // A duo strip is only finished once the partner's half has arrived.
  useEffect(() => {
    if (phase !== 'developing') return

    if (photos.length > 0 && photos.every(Boolean)) {
      setPhase('done')
      return
    }

    const id = window.setTimeout(() => {
      setPhase('done')
      setNotice('Some of your partner’s shots never made it. Printing what we have.')
    }, DEVELOP_TIMEOUT)

    return () => window.clearTimeout(id)
  }, [phase, photos])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      cancelRef.current = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(id)
  }, [notice])

  useEffect(() => {
    if (inviteCode) setDuoOpen(true)
  }, [inviteCode])

  // Once the link is up, both booths show the same two-column strip.
  useEffect(() => {
    if (duoLive) {
      setDuoOpen(false)
      setLayout('duo')
    }
  }, [duoLive])

  /** Style changes propagate so both people take home the same strip. */
  const shareStyle = useCallback(
    (patch: Partial<SharedStyle>) => {
      if (duo.status !== 'live') return
      const next: SharedStyle = { ...styleRef.current, ...patch }
      if (duo.isHost) {
        next.shots = patch.shots ?? shots
        next.timer = patch.timer ?? timer
      }
      duo.send({ t: 'style', style: next })
    },
    [duo, shots, timer],
  )

  const changeFilter = useCallback(
    (id: string) => {
      setFilterId(id)
      shareStyle({ filterId: id })
    },
    [shareStyle],
  )

  const changeTheme = useCallback(
    (id: string) => {
      setThemeId(id)
      shareStyle({ themeId: id })
    },
    [shareStyle],
  )

  const changeCaption = useCallback(
    (value: string) => {
      setCaption(value)
      shareStyle({ caption: value })
    },
    [shareStyle],
  )

  const changeGrain = useCallback(
    (value: boolean) => {
      setGrain(value)
      shareStyle({ grain: value })
    },
    [shareStyle],
  )

  const changeShots = useCallback(
    (value: number) => {
      setShots(value)
      shareStyle({ shots: value })
    },
    [shareStyle],
  )

  const changeTimer = useCallback(
    (value: number) => {
      setTimer(value)
      shareStyle({ timer: value })
    },
    [shareStyle],
  )

  const startShooting = useCallback(() => {
    if (duoLive) {
      if (!duo.isHost) return
      duo.send({ t: 'go', shots, timer })
      setLayout('duo')
      void runSession({ shots, timer, duo: true })
      return
    }
    void runSession({ shots, timer, duo: false })
  }, [duo, duoLive, runSession, shots, timer])

  const stopShooting = useCallback(() => {
    if (duoLive) duo.send({ t: 'stop' })
    resetSession()
  }, [duo, duoLive, resetSession])

  const leaveDuo = useCallback(() => {
    duo.leave()
    setDuoOpen(false)
    if (!photos.some(Boolean)) setLayout('strip')
  }, [duo, photos])

  const buildCanvas = useCallback(
    () =>
      renderStrip({
        photos,
        layout,
        theme,
        filter: filter.css,
        caption,
        date: stripDate,
        grain,
        scale: 2,
      }),
    [caption, filter.css, grain, layout, photos, stripDate, theme],
  )

  const handleDownload = useCallback(async () => {
    if (!photos.length) return
    setBusy(true)
    try {
      const canvas = await buildCanvas()
      const blob = await canvasToBlob(canvas)
      downloadBlob(blob, `photobooth-${fileStamp()}.png`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save the strip.')
    } finally {
      setBusy(false)
    }
  }, [buildCanvas, photos.length])

  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  const handleShare = useCallback(async () => {
    if (!photos.length) return
    setBusy(true)
    try {
      const canvas = await buildCanvas()
      const blob = await canvasToBlob(canvas)
      const file = new File([blob], `photobooth-${fileStamp()}.png`, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Photobooth strip' })
      } else {
        downloadBlob(blob, file.name)
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setNotice(err instanceof Error ? err.message : 'Sharing failed.')
      }
    } finally {
      setBusy(false)
    }
  }, [buildCanvas, photos.length])

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []).slice(0, shots)
      if (!files.length) return

      setBusy(true)
      try {
        const next = await Promise.all(files.map(fileToPhoto))
        setPhotos(next)
        setStripDate(formatStripDate())
        setPhase('done')
        if (next.length < shots) {
          setNotice(`Added ${next.length} of ${shots} — pick more to fill the strip.`)
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Those files would not open.')
      } finally {
        setBusy(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [shots],
  )

  const slots = photos.length > 0 ? photos.length : duoLive ? shots * 2 : shots
  const activeSlot = isRunning
    ? photos.findIndex((photo, index) =>
      !photo && (!duoLive || index % 2 === (duo.isHost ? 0 : 1)),
    )
    : null

  const layoutOptions = useMemo(() => {
    const options = [
      { value: 'strip' as LayoutId, label: 'Strip' },
      { value: 'grid' as LayoutId, label: 'Grid' },
    ]
    if (duoLive || layout === 'duo') options.push({ value: 'duo' as LayoutId, label: 'Duo' })
    return options
  }, [duoLive, layout])

  return (
    <div className="relative min-h-dvh">
      <BoothBackdrop />

      <header className="relative px-4 pt-10 pb-6 text-center sm:pt-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-black/40 px-4 py-1.5 text-[10px] font-semibold tracking-[0.28em] text-gold-400 uppercase sm:text-xs">
            <Sparkles className="size-3.5" />
            Open 24 hours
          </span>

          <div className="relative px-6 py-3">
            <span aria-hidden className="absolute inset-x-0 top-0 flex justify-between">
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-gold-400 animate-bulb"
                  style={{ animationDelay: `${i * 0.16}s` }}
                />
              ))}
            </span>

            <h1 className="text-marquee text-[13vw] leading-[0.95] sm:text-6xl lg:text-7xl">
              Photo Booth
            </h1>

            <span aria-hidden className="absolute inset-x-0 bottom-0 flex justify-between">
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-gold-400 animate-bulb"
                  style={{ animationDelay: `${i * 0.16 + 0.4}s` }}
                />
              ))}
            </span>
          </div>

          <p className="mt-5 max-w-md text-sm text-cream/70 sm:text-base">
            Four shots, one countdown, zero do-overs. Strike a pose and take the strip home.
          </p>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl gap-5 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-start lg:gap-7 lg:px-8">
        <div className="space-y-5">
          <CameraStage
            videoRef={camera.videoRef}
            stream={camera.stream}
            status={camera.status}
            message={camera.message}
            filter={filter.css}
            mirror={mirror}
            grain={grain}
            canSwitch={camera.canSwitch}
            countdown={countdown}
            flash={flash}
            freeze={freeze}
            shotNumber={
              Math.floor(photos.filter(Boolean).length / (duoLive ? 2 : 1)) + (isRunning ? 1 : 0)
            }
            totalShots={shots}
            isRunning={isRunning}
            duoActive={duoActive}
            remoteStream={duo.remoteStream}
            remotePreview={duo.remotePreview}
            relaying={relaying}
            onStartCamera={() => void camera.start()}
            onFlip={camera.flip}
            onUpload={() => fileInputRef.current?.click()}
          />

          <Panel title="The shoot">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shots">
                <Segmented
                  value={shots}
                  onChange={changeShots}
                  disabled={isBusy || !canDrive}
                  options={SHOT_OPTIONS.map((n) => ({ value: n as number, label: `${n} photos` }))}
                />
              </Field>
              <Field label="Countdown">
                <Segmented
                  value={timer}
                  onChange={changeTimer}
                  disabled={isBusy || !canDrive}
                  options={TIMER_OPTIONS.map((n) => ({ value: n as number, label: `${n} seconds` }))}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Toggle
                label="Mirror"
                checked={mirror}
                onChange={setMirror}
                icon={<FlipHorizontal2 className="size-4" />}
              />
              <Toggle
                label="Sound"
                checked={soundOn}
                onChange={setSoundOn}
                icon={<Volume2 className="size-4" />}
              />
              <Toggle
                label="Film grain"
                checked={grain}
                onChange={changeGrain}
                icon={<Sparkles className="size-4" />}
              />
            </div>

            <div className="mt-5">
              {isBusy ? (
                <Button variant="outline" size="lg" className="w-full" onClick={stopShooting}>
                  <Square className="size-4 fill-current" />
                  {phase === 'developing' ? 'Developing…' : 'Stop the booth'}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="w-full"
                  disabled={camera.status !== 'ready' || !canDrive}
                  onClick={startShooting}
                >
                  <Aperture className="size-5" />
                  {!canDrive
                    ? 'Your partner starts the countdown'
                    : hasStrip
                      ? 'Shoot another strip'
                      : duoLive
                        ? 'Start together'
                        : 'Start the countdown'}
                </Button>
              )}
            </div>

            {/* Collaborative shots */}
            <div className="mt-3">
              {duo.status === 'off' || duo.status === 'error' ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    sound.unlock()
                    setDuoOpen(true)
                  }}
                >
                  <Users className="size-5" /> Collaborative shots
                </Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-2xl border border-neon-pink/35 bg-neon-pink/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-2.5 text-sm text-cream/85">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        duoLive ? 'bg-neon-mint' : 'bg-gold-400 animate-bulb',
                      )}
                    />
                    {duoLive ? (
                      duo.peerCameraReady ? (
                        <>
                          {relaying ? 'Relayed booth' : 'Shared booth'} · you shoot the{' '}
                          <strong className="font-semibold text-cream">
                            {duo.isHost ? 'left' : 'right'}
                          </strong>{' '}
                          column
                        </>
                      ) : (
                        'Shared booth · waiting for their camera'
                      )
                    ) : duo.status === 'linking' ? (
                      'Connecting you two…'
                    ) : (
                      <>
                        Booth <strong className="font-display text-gold-400">{duo.code}</strong> ·
                        waiting
                      </>
                    )}
                  </span>

                  <span className="flex shrink-0 gap-2">
                    {!duoLive && (
                      <Button variant="ghost" size="sm" onClick={() => setDuoOpen(true)}>
                        <Link2 className="size-4" /> Link
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={leaveDuo}>
                      <LogOut className="size-4" /> Leave
                    </Button>
                  </span>
                </div>
              )}
            </div>

            {camera.status !== 'ready' && !isBusy && (
              <p className="mt-3 text-center text-xs text-cream/50">
                Turn the camera on to start — or drop in photos you already have.
              </p>
            )}
          </Panel>
        </div>

        <div className="space-y-5 lg:sticky lg:top-6">
          <Panel className="flex flex-col items-center">
            <div
              className={cn(
                'w-full transition-all duration-500',
                layout === 'strip' ? 'max-w-[19rem] sm:max-w-[21rem]' : 'max-w-[24rem]',
                hasStrip && 'animate-sway',
              )}
            >
              <PhotoStrip
                photos={photos}
                slots={slots}
                layout={layout}
                theme={theme}
                filter={filter.css}
                caption={caption}
                date={stripDate}
                grain={grain}
                activeSlot={activeSlot}
              />
            </div>

            <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
              <Button
                variant="pink"
                size="md"
                className="flex-1"
                disabled={!hasStrip || busy}
                onClick={() => void handleDownload()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Download
              </Button>

              {canShare && (
                <Button
                  variant="outline"
                  size="md"
                  disabled={!hasStrip || busy}
                  onClick={() => void handleShare()}
                >
                  <Share2 className="size-4" /> Share
                </Button>
              )}

              <Button
                variant="ghost"
                size="md"
                disabled={!photos.length || isBusy}
                onClick={resetSession}
              >
                <RotateCcw className="size-4" /> Clear
              </Button>
            </div>

            {!hasStrip && (
              <p className="mt-3 text-center text-xs text-cream/50">
                {phase === 'developing'
                  ? 'Waiting on your partner’s shots…'
                  : isRunning
                    ? 'Hold that pose…'
                    : duoLive
                      ? 'You on the left, them on the right.'
                      : 'Your strip prints here.'}
              </p>
            )}
          </Panel>

          <Panel title="Make it yours">
            <div className="space-y-4">
              <Field label="Filter">
                <SwatchGroup
                  withLabels
                  value={filterId}
                  onChange={changeFilter}
                  items={FILTERS.map((f) => ({ id: f.id, label: f.label, background: f.swatch }))}
                />
              </Field>

              <Field label="Frame">
                <SwatchGroup
                  withLabels
                  value={themeId}
                  onChange={changeTheme}
                  items={THEMES.map((t) => ({
                    id: t.id,
                    label: t.label,
                    background: `linear-gradient(160deg, ${t.bg[0]}, ${t.bg[1]})`,
                  }))}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Layout">
                  <Segmented value={layout} onChange={setLayout} options={layoutOptions} />
                </Field>

                <Field label="Caption">
                  <input
                    value={caption}
                    onChange={(event) => changeCaption(event.target.value)}
                    maxLength={28}
                    placeholder="us, obviously"
                    className="h-11 w-full rounded-full border border-cream/15 bg-black/40 px-4 font-hand text-lg text-cream placeholder:font-sans placeholder:text-sm placeholder:text-cream/35 focus:border-gold-400/70 focus:outline-none"
                  />
                </Field>
              </div>
            </div>
          </Panel>
        </div>
      </main>

      <footer className="relative px-6 pb-10 text-center text-xs text-cream/45">
        <p>
          Everything happens in your browser — shared booths send photos straight to your partner,
          never to a server.
        </p>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <DuoDialog
        open={duoOpen}
        status={duo.status}
        code={duo.code}
        inviteUrl={duo.inviteUrl}
        isHost={duo.isHost}
        error={duo.error}
        cameraReady={camera.status === 'ready'}
        initialCode={inviteCode}
        onClose={() => setDuoOpen(false)}
        onStartCamera={() => void camera.start()}
        onInvite={() => {
          sound.unlock()
          duo.invite()
        }}
        onJoin={(code) => {
          sound.unlock()
          duo.join(code)
        }}
        onLeave={leaveDuo}
      />

      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-5 z-50 mx-auto max-w-sm animate-drop rounded-2xl border border-gold-500/40 bg-curtain-800/95 px-4 py-3 text-center text-sm text-cream shadow-2xl backdrop-blur"
        >
          {notice}
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {countdown !== null ? `${countdown}` : hasStrip ? 'Your strip is ready' : ''}
      </div>
    </div>
  )
}
