import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldFocusClass, fieldInvalidClass } from "./field-styles";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // Те же состояния, что у Input (DS «Form States»). resize-none по
          // дефолту — ручное растягивание ломает компоновку формы; для
          // редкого случая передайте className="resize-y". На телефоне 16px
          // (как у Input), иначе iOS увеличивает страницу при фокусе.
          "flex min-h-[80px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          fieldFocusClass,
          fieldInvalidClass,
          "read-only:focus-visible:border-input read-only:focus-visible:ring-0 [&:read-only:not(:disabled)]:bg-muted/50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
