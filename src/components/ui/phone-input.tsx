"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  formatPhoneDisplay,
  formatPhonePartial,
  normalizePhone,
} from "@/lib/format/phone";

/**
 * PhoneInput — controlled RU phone input with `+7 (XXX) XXX-XX-XX` mask.
 *
 * `value` / `onChange` work in **E.164** (`+79254479934` or empty string).
 * The displayed value is always the masked form; the input never exposes
 * raw digits to the parent.
 *
 * Paste support: pasting `89254479934`, `+7 925...`, or `(925) 447-99-34`
 * all normalize to the same E.164 onChange call.
 */
export interface PhoneInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "defaultValue"
  > {
  /** E.164 (`+7XXXXXXXXXX`) or empty string. */
  value: string;
  /** Receives E.164 (`+7XXXXXXXXXX`) or empty string when cleared. */
  onChange: (e164: string) => void;
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, onBlur, placeholder, className, ...rest }, ref) => {
    // Display state is derived from `value` but kept locally so partial
    // typing (5 of 10 digits) doesn't cause the parent to round-trip
    // through E.164 (which would erase the trailing digits).
    const [display, setDisplay] = React.useState(() => formatPhoneDisplay(value));

    // Re-sync display whenever the canonical value changes from outside
    // (form reset, defaultValue load, etc.).
    React.useEffect(() => {
      const next = formatPhoneDisplay(value);
      setDisplay((prev) => (normalizePhone(prev) === value ? prev : next));
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const partial = formatPhonePartial(raw);
      setDisplay(partial);
      const e164 = normalizePhone(partial);
      onChange(e164 ?? "");
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // On blur, re-format from canonical value so trailing whitespace /
      // half-typed segments collapse to either full mask or empty.
      setDisplay(value ? formatPhoneDisplay(value) : "");
      onBlur?.(e);
    };

    return (
      <Input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder ?? "+7 (999) 000-00-00"}
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        className={className}
        {...rest}
      />
    );
  },
);
PhoneInput.displayName = "PhoneInput";
