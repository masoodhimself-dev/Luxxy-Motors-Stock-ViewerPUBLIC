import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-normal text-center gap-2 rounded-md font-display text-sm font-semibold  tracking-normal transition-colors  focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50   active:shadow-none border border-transparent",
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
        default: "min-h-11 px-5 py-2.5",
        sm: "min-h-11 px-3 py-2",
        lg: "min-h-12 px-6 py-3 text-sm",
        icon: "h-11 w-11 shrink-0",
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
