import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)+2px)] border border-transparent text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(160deg,hsl(var(--primary)),hsl(var(--primary-strong)))] text-[hsl(var(--primary-foreground))] shadow-[0_16px_26px_-18px_hsl(var(--primary)/0.95)] hover:brightness-95",
        outline:
          "border-[hsl(var(--border-strong))] bg-[hsl(var(--card))/0.82] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))/0.78]",
        ghost:
          "border-transparent bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))/0.72] hover:text-[hsl(var(--foreground))]",
        secondary:
          "border-[hsl(var(--accent))/0.35] bg-[hsl(var(--accent))/0.2] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent))/0.28]",
      },
      size: {
        default: "h-11 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
