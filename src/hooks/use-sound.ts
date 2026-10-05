import { useCallback, useEffect, useRef } from 'react'

type AudioContextCtor = typeof AudioContext

/**
 * Tiny synthesised booth SFX — no audio files, no network. Everything is built
 * from oscillators and a noise buffer so the bundle stays clean.
 */
export function useSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)

  const context = useCallback(() => {
    if (!enabled) return null
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
      if (!Ctor) return null
      ctxRef.current = new Ctor()
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
    return ctxRef.current
  }, [enabled])

  /** Call from a user gesture so mobile browsers unlock playback. */
  const unlock = useCallback(() => {
    context()
  }, [context])

  const tone = useCallback(
    (frequency: number, duration: number, type: OscillatorType = 'sine', gain = 0.16) => {
      const ctx = context()
      if (!ctx) return

      const osc = ctx.createOscillator()
      const amp = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(frequency, ctx.currentTime)
      amp.gain.setValueAtTime(0.0001, ctx.currentTime)
      amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
      osc.connect(amp).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + duration + 0.02)
    },
    [context],
  )

  const tick = useCallback(() => tone(660, 0.09, 'triangle', 0.1), [tone])
  const ding = useCallback(() => {
    tone(1180, 0.16, 'sine', 0.14)
    tone(1580, 0.2, 'sine', 0.07)
  }, [tone])

  const shutter = useCallback(() => {
    const ctx = context()
    if (!ctx) return

    const length = Math.floor(ctx.sampleRate * 0.09)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.2
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 2400
    filter.Q.value = 0.9

    const amp = ctx.createGain()
    amp.gain.value = 0.5

    source.connect(filter).connect(amp).connect(ctx.destination)
    source.start()

    tone(180, 0.06, 'square', 0.09)
  }, [context, tone])

  useEffect(
    () => () => {
      void ctxRef.current?.close()
      ctxRef.current = null
    },
    [],
  )

  return { unlock, tick, ding, shutter }
}
