"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

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

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  portalContainer?: HTMLElement | null;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, portalContainer, onOpenAutoFocus = focusOverlayContent, ...props }, ref) => (
  <PopoverPrimitive.Portal container={portalContainer}>
    <PopoverPrimitive.Content
      ref={ref}
      tabIndex={-1}
      onOpenAutoFocus={onOpenAutoFocus}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
