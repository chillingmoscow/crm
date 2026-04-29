"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { AddressSuggestion } from "@/lib/dadata/address";

export type AddressInputProps = {
  value: string;
  onChange: (next: string) => void;
  /** Optional callback on suggestion pick — useful to capture extra fields. */
  onPick?: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
};

/**
 * Address field with debounced live suggestions from DaData
 * (suggestions API). The dropdown opens on focus + non-empty value
 * and closes on outside click / Escape / suggestion pick.
 *
 * Calls the server route /api/dadata/address which gates on
 * auth + settings.use_dadata.
 */
export const AddressInput = forwardRef<HTMLInputElement, AddressInputProps>(
  function AddressInput(
    { value, onChange, onPick, placeholder, id, disabled },
    ref
  ) {
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    // One-shot flag set by `pick()` so the very next value-driven effect
    // skips refetching for the suggestion the user just clicked. Re-typing
    // the same query later still triggers a fresh lookup.
    const skipNextFetchRef = useRef(false);

    // Debounced fetch.
    useEffect(() => {
      const query = value.trim();
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (query.length < 2) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      if (skipNextFetchRef.current) {
        skipNextFetchRef.current = false;
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/dadata/address", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, count: 7 }),
          });
          if (!res.ok) {
            setSuggestions([]);
            return;
          }
          const json = (await res.json()) as { suggestions: AddressSuggestion[] };
          setSuggestions(json.suggestions ?? []);
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }, 250);

      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, [value]);

    // Close on outside click.
    useEffect(() => {
      const onClick = (e: MouseEvent) => {
        if (!wrapperRef.current?.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }, []);

    const pick = (suggestion: AddressSuggestion) => {
      // Suppress the immediate refetch that would otherwise fire from
      // the value-change effect. The dropdown is closed too, so the
      // user sees their selection without a flicker.
      skipNextFetchRef.current = true;
      onChange(suggestion.value);
      onPick?.(suggestion);
      setOpen(false);
    };

    return (
      <div ref={wrapperRef} className="relative">
        <Input
          ref={ref}
          id={id}
          placeholder={placeholder ?? "г Москва, ул Тверская, д 1"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (value.trim().length >= 2 && suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          disabled={disabled}
          autoComplete="off"
        />

        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}

        {open && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            <ul className="max-h-72 overflow-y-auto py-1 text-sm">
              {suggestions.map((s) => (
                <li key={s.unrestricted}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-accent"
                  >
                    {s.value}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
);
