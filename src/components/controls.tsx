import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Panel({
  title,
  children,
  className,
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-3xl border border-gold-600/25 bg-black/35 p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm sm:p-5',
        className,
      )}
    >
      {title && (
        <h3 className="mb-4 font-display text-[11px] tracking-[0.22em] text-gold-400 uppercase sm:text-xs">
          {title}
        </h3>
      )}
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="block text-[11px] font-semibold tracking-[0.18em] text-cream/55 uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

interface SegmentedProps<T extends string | number> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'flex w-full gap-1 rounded-full border border-cream/15 bg-black/40 p-1',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'flex-1 rounded-full px-3 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 sm:text-sm',
              active
                ? 'bg-gradient-to-b from-gold-400 to-gold-600 text-ink shadow-[0_2px_10px_rgba(245,196,81,0.45)]'
                : 'text-cream/65 hover:bg-cream/10 hover:text-cream',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface SwatchGroupProps {
  items: { id: string; label: string; background: string; ring?: string }[]
  value: string
  onChange: (id: string) => void
  /** Show the label under each swatch. */
  withLabels?: boolean
}

export function SwatchGroup({ items, value, onChange, withLabels }: SwatchGroupProps) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={active}
            className="group flex flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                'relative grid size-10 place-items-center rounded-full transition-all duration-200 sm:size-11',
                active
                  ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-curtain-900'
                  : 'ring-1 ring-cream/20 group-hover:ring-cream/50',
              )}
              style={{ background: item.background }}
            >
              {active && <Check className="size-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />}
            </span>
            {withLabels && (
              <span
                className={cn(
                  'text-[10px] font-medium tracking-wide transition-colors',
                  active ? 'text-gold-400' : 'text-cream/50 group-hover:text-cream/80',
                )}
              >
                {item.label}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  icon?: ReactNode
}

export function Toggle({ label, checked, onChange, icon }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-all duration-200 sm:text-sm',
        checked
          ? 'border-gold-400/70 bg-gold-500/15 text-gold-400'
          : 'border-cream/15 bg-black/30 text-cream/55 hover:border-cream/35 hover:text-cream/80',
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-gold-500' : 'bg-cream/25',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full bg-white transition-all duration-200',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  )
}
