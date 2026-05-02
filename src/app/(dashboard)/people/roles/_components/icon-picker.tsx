"use client";

import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PICKABLE_ICONS, iconForRole } from "./role-icons";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  /** Текущее имя иконки (из ICON_REGISTRY) или null = «по умолчанию» */
  value: string | null;
  /** Системный код роли — для preview дефолтной иконки. Для новой роли передайте "". */
  roleCode: string;
  onChange: (iconName: string | null) => void;
  disabled?: boolean;
}

export function IconPicker({ value, roleCode, onChange, disabled }: IconPickerProps) {
  const CurrentIcon = iconForRole(roleCode, value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Compact 40px trigger per design (S361n / iconTrigger3):
            input-style border + padding [0,8] + gap 6, current icon (16) + chevron (13). */}
        <button
          type="button"
          disabled={disabled}
          aria-label="Выбрать иконку"
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 rounded-lg border border-input bg-background px-2 transition-colors shrink-0",
            "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
            "data-[state=open]:bg-accent",
          )}
        >
          <CurrentIcon className="w-4 h-4 text-foreground" />
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[280px] p-2 rounded-[10px]"
      >
        <div className="grid grid-cols-6 gap-1 max-h-[280px] overflow-y-auto pr-1 -mr-1">
          {PICKABLE_ICONS.map(({ name, icon: Icon, label }) => {
            const isActive = value === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange(isActive ? null : name)}
                aria-label={label}
                title={label}
                className={cn(
                  "flex items-center justify-center size-10 rounded-lg transition-colors",
                  isActive
                    ? "bg-brand/10 text-brand"
                    : "text-foreground hover:bg-accent",
                )}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
        <div className="px-2 py-2 mt-1 border-t text-[11px] text-muted-foreground leading-relaxed">
          Клик по выбранной иконке — сбросить к иконке по умолчанию.
        </div>
      </PopoverContent>
    </Popover>
  );
}
