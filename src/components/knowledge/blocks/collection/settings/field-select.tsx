"use client";

import { useState } from "react";

import { Check, ChevronDown } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KbCollectionField } from "@/lib/knowledge/collection";

import {
  FIELD_ICONS,
  collectionFieldMenuLabel,
  stopBlockInteraction,
  stopBlockMenuAction,
} from "../shared";

export function CollectionFieldSelect({
  fields,
  value,
  placeholder,
  emptyLabel,
  searchPlaceholder,
  onChange,
}: {
  fields: KbCollectionField[];
  value: string;
  placeholder: string;
  emptyLabel?: string;
  searchPlaceholder: string;
  onChange: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedField = fields.find((field) => field.id === value);
  const selectedLabel = selectedField
    ? collectionFieldMenuLabel(selectedField)
    : emptyLabel ?? placeholder;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredFields = fields.filter((field) =>
    collectionFieldMenuLabel(field).toLowerCase().includes(normalizedQuery),
  );

  const renderIcon = (field: KbCollectionField) => {
    const Icon = FIELD_ICONS[field.type];
    return field.icon ? (
      <KbPageIcon icon={field.icon} color={field.iconColor ?? null} size={16} />
    ) : (
      <Icon className="size-4 text-muted-foreground" />
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="kb-collection-field-select-trigger"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
        >
          {selectedField ? (
            renderIcon(selectedField)
          ) : (
            <span className="kb-collection-field-select-empty-icon" />
          )}
          <span>{selectedLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="kb-collection-field-select-menu"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Input
          value={query}
          placeholder={searchPlaceholder}
          className="kb-collection-field-select-search"
          aria-label={searchPlaceholder}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="kb-collection-field-select-list">
          {emptyLabel && (
            <button
              type="button"
              className="kb-collection-field-select-option"
              data-active={!value || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onChange("");
                setOpen(false);
              }}
            >
              <span className="kb-collection-field-select-empty-icon" />
              <span>{emptyLabel}</span>
              {!value && <Check className="size-4" />}
            </button>
          )}
          {filteredFields.length === 0 ? (
            <div className="kb-collection-field-select-empty">
              Свойства не найдены
            </div>
          ) : (
            filteredFields.map((field) => {
              const active = field.id === value;
              return (
                <button
                  key={field.id}
                  type="button"
                  className="kb-collection-field-select-option"
                  data-active={active || undefined}
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    onChange(field.id);
                    setOpen(false);
                  }}
                >
                  {renderIcon(field)}
                  <span>{collectionFieldMenuLabel(field)}</span>
                  {active && <Check className="size-4" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
