"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { overlayClass } from "@/lib/overlay-classes"
import { focusOverlayContent } from "@/lib/overlay-focus"
import { useSsrSafeAriaControls } from "@/hooks/use-hydrated"
import { DIALOG_TONE_ICON_CLASS, type DialogTone } from "@/components/ui/dialog-tone"

const Dialog = DialogPrimitive.Root

/**
 * `aria-controls` не уходит в SSR-разметку — атрибут дорисовывается
 * после гидратации. Почему так — см. useSsrSafeAriaControls в
 * `src/hooks/use-hydrated.ts`.
 */
const DialogTrigger = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => (
  <DialogPrimitive.Trigger ref={ref} {...useSsrSafeAriaControls()} {...props} />
))
DialogTrigger.displayName = DialogPrimitive.Trigger.displayName

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // Единый overlayClass (bg-black/25, движение .motion-overlay) —
    // см. src/lib/overlay-classes.ts и docs/design-system.md § Overlays.
    className={cn(overlayClass, className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Скрыть встроенный X-крестик в углу. Используй для подтверждений
   * с двумя явными кнопками (например, «Закрыть без сохранения»),
   * где X дублирует одну из них и сбивает.
   */
  hideClose?: boolean;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose, onOpenAutoFocus = focusOverlayContent, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      tabIndex={-1}
      onOpenAutoFocus={onOpenAutoFocus}
      className={cn(
        // Вид окна — docs/design-system.md, «Modal»: 480px, радиус 12,
        // отступы 24, полоса кнопок `DialogFooter` дотягивается до краёв.
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-[480px] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-[0_24px_56px_-16px_rgb(9_9_11/0.28)] motion-dialog sm:rounded-xl",
        "outline-none",
        // Длинный заголовок не налезает на крестик.
        !hideClose && "[&>*:first-child]:pr-8",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          aria-label="Закрыть"
          className="touch-target absolute right-5 top-5 rounded-sm text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Закрыть</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1.5 text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

/**
 * Полоса кнопок внизу окна: серый фон во всю ширину, линия сверху, справа
 * «Отмена» и главная кнопка. Слева — `hint` (подсказка клавиш, только на
 * компьютере). На телефоне кнопки во всю ширину столбиком, главная сверху.
 * Рассчитана на стандартный отступ `DialogContent` (p-6).
 */
const DialogFooter = ({
  className,
  hint,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hint?: React.ReactNode }) => (
  <div
    className={cn(
      "-mx-6 -mb-6 mt-2 flex flex-col-reverse gap-2 border-t bg-muted/50 py-3 pl-6 pr-4 sm:flex-row sm:items-center sm:justify-end sm:rounded-b-xl",
      "[&>button]:w-full sm:[&>button]:w-auto",
      className
    )}
    {...props}
  >
    {hint ? (
      <div className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        {hint}
      </div>
    ) : null}
    {children}
  </div>
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-[18px] font-semibold leading-tight tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-normal text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

/**
 * Значок окна: круг 40px с подложкой цвета тона на 10%, над заголовком.
 * Тон — по смыслу действия (`DialogTone`), не для красоты.
 */
function DialogIcon({
  tone,
  icon: Icon,
  className,
}: {
  tone: DialogTone
  icon: LucideIcon
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "mb-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full",
        DIALOG_TONE_ICON_CLASS[tone],
        className
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

/** Mac определяется после монтирования: navigator есть только в браузере. */
function useIsMac() {
  const [isMac, setIsMac] = React.useState(true)
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent))
  }, [])
  return isMac
}

/**
 * Подсказка клавиш в полосе кнопок: «⌘ ↵ перевести», «Esc отмена».
 * «⌘» на Windows и Linux показывается как Ctrl.
 */
function DialogHotkeyHint({ keys, label }: { keys: string[]; label: string }) {
  const isMac = useIsMac()
  return (
    <>
      <span className="inline-flex items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="inline-flex min-w-[20px] items-center justify-center rounded-sm border border-border bg-background px-1.5 py-px font-mono text-xs font-semibold text-muted-foreground"
          >
            {k === "⌘" && !isMac ? "Ctrl" : k}
          </kbd>
        ))}
      </span>
      <span>{label}</span>
    </>
  )
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogIcon,
  DialogHotkeyHint,
}
