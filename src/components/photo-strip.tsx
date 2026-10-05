import { Sparkles } from 'lucide-react'

import { LAYOUTS, PHOTO_ASPECT, type FrameTheme, type LayoutId } from '@/lib/photobooth'
import { cn } from '@/lib/utils'

export interface PhotoStripProps {
  photos: (string | null | undefined)[]
  slots: number
  layout: LayoutId
  theme: FrameTheme
  filter: string
  caption: string
  date: string
  grain: boolean
  /** Slot the booth is about to fill, highlighted while shooting. */
  activeSlot?: number | null
  className?: string
}

/**
 * The on-screen strip. Sizes come from the same design-space constants the
 * canvas exporter uses, expressed in container query units, so what you see
 * here is what lands in the downloaded PNG.
 */
export function PhotoStrip({
  photos,
  slots,
  layout,
  theme,
  filter,
  caption,
  date,
  grain,
  activeSlot = null,
  className,
}: PhotoStripProps) {
  const spec = LAYOUTS[layout]
  const cq = (value: number) => `${((value / spec.width) * 100).toFixed(3)}cqw`
  const trimmed = caption.trim()

  return (
    <div className={cn('[container-type:inline-size]', className)}>
      <div
        className="rounded-[6px] shadow-[0_28px_60px_-24px_rgba(0,0,0,0.85)]"
        style={{
          background: `linear-gradient(180deg, ${theme.bg[0]}, ${theme.bg[1]})`,
          padding: cq(spec.padding),
          color: theme.ink,
        }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${spec.columns}, minmax(0, 1fr))`,
            gap: cq(spec.gap),
          }}
        >
          {Array.from({ length: slots }).map((_, index) => {
            const photo = photos[index]
            const isNext = activeSlot === index

            return (
              <div
                key={index}
                className={cn(
                  'relative overflow-hidden',
                  isNext && 'animate-pulse ring-2 ring-neon-pink ring-inset',
                )}
                style={{
                  aspectRatio: `${PHOTO_ASPECT}`,
                  boxShadow: `inset 0 0 0 1px ${theme.edge}`,
                  background: photo ? undefined : 'rgba(0,0,0,0.06)',
                }}
              >
                {photo ? (
                  <>
                    <img
                      src={photo}
                      alt={`Booth shot ${index + 1}`}
                      className="size-full animate-drop object-cover"
                      style={{ filter }}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_75%_at_50%_50%,transparent_35%,rgba(0,0,0,0.22))]" />
                    {grain && (
                      <div className="pointer-events-none absolute inset-0 grain-overlay opacity-[0.16] mix-blend-overlay" />
                    )}
                  </>
                ) : (
                  <div
                    className="grid size-full place-items-center"
                    style={{ color: theme.sub }}
                  >
                    <span
                      className="font-display leading-none opacity-60"
                      style={{ fontSize: cq(52) }}
                    >
                      {index + 1}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="text-center">
          {trimmed ? (
            <p
              className="font-hand break-words"
              style={{ fontSize: cq(46), lineHeight: 1.15, marginTop: cq(20) }}
            >
              {trimmed}
            </p>
          ) : null}

          <p
            className="font-sans font-semibold uppercase"
            style={{
              fontSize: cq(19),
              letterSpacing: cq(3),
              marginTop: cq(trimmed ? 12 : 22),
              color: theme.sub,
            }}
          >
            {date}
          </p>

          <p
            className="flex items-center justify-center font-display uppercase opacity-55"
            style={{
              fontSize: cq(15),
              letterSpacing: cq(2),
              marginTop: cq(12),
              gap: cq(8),
              color: theme.sub,
            }}
          >
            <Sparkles style={{ width: cq(16), height: cq(16) }} />
            Wishora
            <Sparkles style={{ width: cq(16), height: cq(16) }} />
          </p>
        </div>
      </div>
    </div>
  )
}
