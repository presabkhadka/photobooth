import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-wide transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-curtain-900 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-b from-gold-400 to-gold-600 text-ink shadow-[0_6px_0_0_#a8721a,0_14px_30px_-8px_rgba(245,196,81,0.7)] hover:from-gold-400 hover:to-gold-500 hover:shadow-[0_6px_0_0_#a8721a,0_18px_38px_-8px_rgba(245,196,81,0.85)] active:shadow-[0_3px_0_0_#a8721a]',
        pink: 'bg-gradient-to-b from-neon-pink to-[#d92e6c] text-white shadow-[0_6px_0_0_#8e1442,0_14px_30px_-10px_rgba(255,77,141,0.7)] active:shadow-[0_3px_0_0_#8e1442]',
        outline:
          'border-2 border-cream/35 bg-cream/5 text-cream backdrop-blur-sm hover:border-gold-400/70 hover:bg-cream/10 hover:text-gold-400',
        ghost: 'text-cream/75 hover:bg-cream/10 hover:text-cream',
      },
      size: {
        sm: 'h-9 px-4 text-xs',
        md: 'h-11 px-5 text-sm',
        lg: 'h-14 px-8 text-base',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
