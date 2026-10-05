import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface BulbRowProps {
  count: number
  className: string
  vertical?: boolean
}

function BulbRow({ count, className, vertical }: BulbRowProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute flex items-center justify-between',
        vertical ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className="block size-2 rounded-full bg-gold-400 animate-bulb sm:size-2.5"
          style={{ animationDelay: `${(index % 6) * 0.22}s` }}
        />
      ))}
    </div>
  )
}

interface MarqueeFrameProps {
  children: ReactNode
  className?: string
  bulbs?: number
}

/** A lightbulb-studded booth frame. */
export function MarqueeFrame({ children, className, bulbs = 12 }: MarqueeFrameProps) {
  return (
    <div
      className={cn(
        'relative rounded-[28px] border-2 border-gold-600/60 bg-gradient-to-b from-curtain-700 to-curtain-900 p-3.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,217,119,0.25)] sm:p-5',
        className,
      )}
    >
      <BulbRow count={bulbs} className="inset-x-5 top-1.5 sm:inset-x-7 sm:top-2" />
      <BulbRow count={bulbs} className="inset-x-5 bottom-1.5 sm:inset-x-7 sm:bottom-2" />
      <BulbRow count={5} vertical className="inset-y-6 left-1.5 sm:left-2" />
      <BulbRow count={5} vertical className="inset-y-6 right-1.5 sm:right-2" />
      <div className="relative overflow-hidden rounded-[18px] bg-black/60 ring-1 ring-gold-600/30">
        {children}
      </div>
    </div>
  )
}
