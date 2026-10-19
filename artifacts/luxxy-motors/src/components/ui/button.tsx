import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "db-btn balanced-button inline-flex items-center justify-center whitespace-normal text-center gap-2 rounded-md font-display text-sm font-semibold  tracking-normal transition-[background-color,color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50   active:shadow-none border border-transparent",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 border-primary shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-destructive shadow-none",
        outline:
          "border border-input bg-card text-primary hover:bg-primary hover:text-primary-foreground shadow-none",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground border-transparent shadow-none",
        ghost: "hover:bg-secondary hover:text-primary border-transparent",
        link: "text-primary underline-offset-4 hover:underline border-transparent shadow-none  ",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90 border-accent shadow-none",
      },
      size: {
        default: "db-btn--standard min-h-12 px-5 py-3",
        sm: "db-btn--compact min-h-11 px-3 py-2",
        lg: "db-btn--prominent min-h-[52px] px-6 py-3 text-sm",
        icon: "db-btn--icon h-11 w-11 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  'data-state'?: string
  status?: 'idle' | 'loading' | 'success'
  loadingLabel?: string
  successLabel?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, 'data-state': controlState, status, loadingLabel = 'Working…', successLabel = 'Complete', children, onClick, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const busy = status === 'loading'
    const blocked = disabled || busy || props['aria-disabled'] === true || props['aria-disabled'] === 'true'
    // Keep Slot children intact: existing links and Radix triggers depend on them.
    const content = asChild || status === undefined ? children : <>
      <span className="db-labels">
        <span className="db-label-idle" aria-hidden={status !== 'idle'}>{children}</span>
        <span className="db-label-loading" aria-hidden={!busy}>{loadingLabel}</span>
        <span className="db-label-success" aria-hidden={status !== 'success'}>{successLabel}</span>
      </span>
    </>
    return <>
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={disabled}
        data-state={status ?? controlState}
        aria-busy={busy || props['aria-busy'] || undefined}
        aria-disabled={blocked || undefined}
        onClick={event => {
          if (blocked) { event.preventDefault(); event.stopPropagation(); return }
          onClick?.(event)
        }}
      >{content}</Comp>
      {!asChild && status !== undefined && <span className="db-sr-only" role="status" aria-live="polite">{busy ? loadingLabel : status === 'success' ? successLabel : ''}</span>}
    </>
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
