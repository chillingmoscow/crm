import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { ButtonStatusContent, type ButtonStatus } from "@/components/ui/button-status"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Default = brand blue (#1570EF) — used for ALL CTAs per Sheerly DS.
        // For non-CTA "neutral primary" actions, use `secondary` or `outline`.
        // Неактивная заливная кнопка серая, а не выцветшая синяя/красная:
        // так видно, что действие недоступно, а не «почти доступно».
        // Пока идёт действие (status), кнопка неактивна, но остаётся синей.
        default: "bg-brand text-brand-foreground hover:bg-brand-hover disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 data-[status]:disabled:bg-brand data-[status]:disabled:text-brand-foreground",
        brand: "bg-brand text-brand-foreground hover:bg-brand-hover disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 data-[status]:disabled:bg-brand data-[status]:disabled:text-brand-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
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
  /**
   * Состояние действия: «pending» — вместо подписи индикатор загрузки
   * (кнопка неактивна, ширина не меняется); «success» — индикатор
   * превращается в галочку, через мгновение возвращается подпись. Берётся
   * из `useSaveStatus`. С `asChild` не работает.
   */
  status?: ButtonStatus
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, status, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const busy = status === "pending" || status === "success"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || (!asChild && busy) || undefined}
        aria-busy={status === "pending" || undefined}
        data-status={status && status !== "idle" ? status : undefined}
        {...props}
      >
        {asChild || status === undefined ? (
          children
        ) : (
          <ButtonStatusContent status={status}>{children}</ButtonStatusContent>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
