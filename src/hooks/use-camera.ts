import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'blocked' | 'unavailable' | 'error'
export type Facing = 'user' | 'environment'

const CAPTURE_WIDTH = 1280
const CAPTURE_HEIGHT = 960
const PREVIEW_WIDTH = 256
const PREVIEW_HEIGHT = 192

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [message, setMessage] = useState('')
  const [facing, setFacing] = useState<Facing>('user')
  const [canSwitch, setCanSwitch] = useState(false)
  /** Exposed so a peer connection can share the same feed. */
  const [stream, setStream] = useState<MediaStream | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(
    async (mode: Facing = facing) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        setMessage(
          'This browser will not hand over a camera. Try Chrome or Safari over https (or localhost).',
        )
        return
      }

      setStatus('starting')
      setMessage('')
      stop()

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: mode,
            width: { ideal: CAPTURE_WIDTH },
            height: { ideal: CAPTURE_HEIGHT },
          },
          audio: false,
        })

        streamRef.current = stream
        setStream(stream)
        setFacing(mode)

        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => undefined)
        }

        setStatus('ready')

        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1)
          })
          .catch(() => undefined)
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''

        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('blocked')
          setMessage('Camera access was denied. Allow it in your browser settings, then try again.')
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable')
          setMessage('No camera found on this device.')
        } else if (name === 'NotReadableError') {
          setStatus('error')
          setMessage('Another app is already using the camera. Close it and try again.')
        } else {
          setStatus('error')
          setMessage(err instanceof Error ? err.message : 'Something went wrong starting the camera.')
        }
      }
    },
    [facing, stop],
  )

  const flip = useCallback(() => {
    void start(facing === 'user' ? 'environment' : 'user')
  }, [facing, start])

  /** Centre-cropped 4:3 grab from the live element, at whatever size is asked for. */
  const grab = useCallback(
    (width: number, height: number, mirror: boolean, quality: number) => {
      const video = videoRef.current
      if (!video || !video.videoWidth || !video.videoHeight) return null

      const canvas = (scratchRef.current ??= document.createElement('canvas'))
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // The canvas is reused between calls, so start from a clean transform.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const target = width / height
      let sx = 0
      let sy = 0
      let sw = video.videoWidth
      let sh = video.videoHeight

      if (sw / sh > target) {
        sw = sh * target
        sx = (video.videoWidth - sw) / 2
      } else {
        sh = sw / target
        sy = (video.videoHeight - sh) / 2
      }

      if (mirror) {
        ctx.translate(width, 0)
        ctx.scale(-1, 1)
      }

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', quality)
    },
    [],
  )

  /** Full-resolution frame for the strip. */
  const capture = useCallback(
    (mirror: boolean) => grab(CAPTURE_WIDTH, CAPTURE_HEIGHT, mirror, 0.92),
    [grab],
  )

  /** Small, cheap frame used as a stand-in for live video over the relay. */
  const snapshot = useCallback(
    (mirror: boolean) => grab(PREVIEW_WIDTH, PREVIEW_HEIGHT, mirror, 0.5),
    [grab],
  )

  // Re-attach the stream if the element remounts, and release the camera on exit.
  useEffect(() => {
    const video = videoRef.current
    if (video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
      void video.play().catch(() => undefined)
    }
  }, [status])

  useEffect(() => stop, [stop])

  return {
    videoRef,
    status,
    message,
    facing,
    canSwitch,
    stream,
    start,
    stop,
    flip,
    capture,
    snapshot,
  }
}
