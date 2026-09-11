import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-none font-display text-[12px] font-bold uppercase tracking-widest transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none border-2 border-transparent",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-accent border-primary shadow-[4px_4px_0px_hsl(var(--primary))]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-destructive shadow-[4px_4px_0px_hsl(var(--primary))]",
        outline:
          "border-2 border-primary bg-background text-primary hover:bg-primary hover:text-primary-foreground shadow-[4px_4px_0px_hsl(var(--primary))]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground border-transparent shadow-[4px_4px_0px_hsl(var(--primary))]",
        ghost: "hover:bg-primary/5 hover:text-primary-foreground border-transparent",
        link: "text-primary underline-offset-4 hover:underline border-transparent shadow-none active:translate-y-0 active:translate-x-0",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90 border-accent shadow-[4px_4px_0px_hsl(var(--accent))]",
      },
      size: {
        default: "h-12 px-6 py-2",
        sm: "h-10 px-4",
        lg: "h-16 px-10 text-[14px]",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
