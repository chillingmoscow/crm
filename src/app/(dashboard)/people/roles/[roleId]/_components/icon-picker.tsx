"use client";

import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PICKABLE_ICONS,
  iconForRole,
} from "../../_components/role-icons";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  /** Текущее имя иконки (из ICON_REGISTRY) или null = «по умолчанию» */
  value: string | null;
  /** Системный код роли — используется для preview дефолтной иконки */
  roleCode: string;
  onChange: (iconName: string | null) => void;
  disabled?: boolean;
}

export function IconPicker({ value, roleCode, onChange, disabled }: IconPickerProps) {
  const CurrentIcon = iconForRole(roleCode, value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Выбрать иконку"
          className={cn(
            "flex items-center gap-2 rounded-lg border border-input bg-background px-2 py-1.5 transition-colors",
            "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
            "data-[state=open]:bg-accent",
          )}
        >
          <span className="flex items-center justify-center size-8 rounded-md bg-brand/10 text-brand">
            <CurrentIcon className="w-4 h-4" />
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[280px] p-2 rounded-[10px]"
      >
        <div className="grid grid-cols-6 gap-1">
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
