import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldFocusClass, fieldInvalidClass } from "./field-styles"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Состояния поля по DS «Form States»: фокус — border swap на brand +
          // halo без смещения; ошибка — красная рамка по aria-invalid.
          // ReadOnly остаётся фокусируемым для скринридеров, но без halo и с
          // приглушённым фоном: значение нельзя поменять. Disabled под
          // `:read-only` тоже попадает, поэтому фон — только для настоящего
          // readOnly. На телефоне 16px, чтобы iOS не увеличивал страницу.
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          fieldFocusClass,
          fieldInvalidClass,
          "read-only:focus-visible:border-input read-only:focus-visible:ring-0 [&:read-only:not(:disabled)]:bg-muted/50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
