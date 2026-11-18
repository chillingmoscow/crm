"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { usePointerCloseFocus } from "./use-pointer-close-focus"
import { cn } from "@/lib/utils"
import { focusOverlayContent } from "@/lib/overlay-focus"
import { useSsrSafeAriaControls } from "@/hooks/use-hydrated"

const Popover = PopoverPrimitive.Root

/**
 * `aria-controls` не уходит в SSR-разметку — атрибут дорисовывается
 * после гидратации. Почему так — см. useSsrSafeAriaControls в
 * `src/hooks/use-hydrated.ts`.
 */
const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, ref) => (
  <PopoverPrimitive.Trigger ref={ref} {...useSsrSafeAriaControls()} {...props} />
))
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName

/**
 * Список с поиском при открытии сразу прокручивает выделенный пункт в
 * видимую область — ещё до того, как попап встал на место. Браузер при этом
 * прокручивает и окно, в котором попап нарисован: окно уезжает к началу, а
 * поле, под которым раскрылся список, — за край. Возвращаем окну прокрутку,
 * которая была в момент открытия; дальше попап уже на месте, и прокрутка
 * пункта затрагивает только сам список.
 */
function KeepContainerScroll({ container }: { container: HTMLElement }) {
  const [top] = React.useState(() => container.scrollTop)
  React.useLayoutEffect(() => {
    const restore = () => { if (container.scrollTop !== top) container.scrollTop = top }
    restore()
    container.addEventListener("scroll", restore)
    const stop = () => container.removeEventListener("scroll", restore)
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(stop) })
    return () => { cancelAnimationFrame(frame); stop() }
  }, [container, top])
  return null
}

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  portalContainer?: HTMLElement | null;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, portalContainer, collisionBoundary, collisionPadding, onOpenAutoFocus = focusOverlayContent, children, ...props }, ref) => {
  // Закрыли мышью — не возвращаем фокус на триггер (иначе рамка и подсказка).
  const focus = usePointerCloseFocus(props)
  // Внутри окна попап рисуется в само окно (иначе окно не даёт его
  // прокручивать). Окно обрезает всё, что выходит за его край, поэтому
  // попап раскрывается туда, где больше места, и не выше доступного —
  // длинный список прокручивается внутри.
  const inContainer = !!portalContainer
  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Content
        ref={ref}
        tabIndex={-1}
        onOpenAutoFocus={onOpenAutoFocus}
        align={align}
        sideOffset={sideOffset}
        collisionBoundary={collisionBoundary ?? (inContainer ? portalContainer : undefined)}
        collisionPadding={collisionPadding ?? (inContainer ? 8 : undefined)}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
          inContainer && "flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-y-auto overscroll-contain",
          className
        )}
        {...props}
        {...focus}
      >
        {children}
        {portalContainer ? <KeepContainerScroll container={portalContainer} /> : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
