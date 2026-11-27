"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Портал: подсказка рисуется поверх страницы, а не внутри контейнера с
  // overflow (таблица, панель) — иначе её обрезает край таблицы.
  <TooltipPrimitive.Portal>
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    // Тёмно-графитовый фон (по аналогии с native browser tooltip'ами).
    // Цвет фиксированный в обеих темах — чтобы tooltip не сливался
    // с light-фоном popover'ов и однозначно читался как «подсказка».
    className={cn(
      "z-50 overflow-hidden rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold leading-tight text-neutral-50 shadow-lg origin-[--radix-tooltip-content-transform-origin]",
      className
    )}
    {...props}
  />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
