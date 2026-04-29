"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  /** Current numeric value, or null when empty. */
  value: number | null;
  /** Called with the parsed numeric value (or null when input is empty). */
  onChange: (value: number | null) => void;
  /**
   * Currency code shown as suffix. Defaults to RUB. Display-only —
   * doesn't affect parsing.
   */
  currency?: string;
  /** When true, allows negative values. Default: false (positive only). */
  allowNegative?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  /** Accessibility label for the field. */
  "aria-label"?: string;
};

const CURRENCY_SUFFIX: Record<string, string> = {
  RUB: "₽",
  USD: "$",
  EUR: "€",
};

/**
 * Russia-friendly money input. Accepts comma or dot as decimal separator,
 * formats the displayed value with NBSPs as thousand separators while
 * the user isn't actively typing in the field. Always emits a JS number
 * (or null) to onChange.
 */
export function AmountInput({
  value,
  onChange,
  currency = "RUB",
  allowNegative = false,
  placeholder = "0",
  disabled,
  className,
  id,
  name,
  ...rest
}: Props) {
  const [text, setText] = useState<string>(formatForDisplay(value));
  const [focused, setFocused] = useState(false);

  // When `value` changes from the outside (e.g. form reset), re-sync the
  // display unless the user is currently editing the field.
  useEffect(() => {
    if (!focused) setText(formatForDisplay(value));
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);

    const parsed = parseAmount(raw, allowNegative);
    onChange(parsed);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        type="text"
        value={text}
        onChange={handleChange}
        onFocus={(e) => {
          setFocused(true);
          // Show the raw machine value on focus so editing is easy.
          if (value !== null) setText(String(value));
          // Caret to end after we replace the text.
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          setText(formatForDisplay(value));
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-8 text-right tabular-nums"
        aria-label={rest["aria-label"]}
      />
      <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground pointer-events-none">
        {CURRENCY_SUFFIX[currency] ?? currency}
      </span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAmount(raw: string, allowNegative: boolean): number | null {
  const trimmed = raw.replace(/ |\s/g, "").replace(",", ".").trim();
  if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-.") {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n < 0) return Math.abs(n);
  return n;
}

function formatForDisplay(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  // Russian locale: NBSP thousands, comma decimal, up to 2 fractional digits.
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
