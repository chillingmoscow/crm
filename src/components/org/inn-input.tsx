"use client";

import { forwardRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ResolvedParty } from "@/lib/dadata/party";

export type InnInputProps = {
  /** Current INN value (controlled). */
  value: string;
  onChange: (next: string) => void;
  /**
   * Called after a successful DaData lookup so the parent form can
   * pre-fill name / legal_form / kpp / ogrn / address / director.
   */
  onParty?: (party: ResolvedParty) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  /** Hide the inline "Подтянуть из DaData" button. */
  hideLookupButton?: boolean;
};

/**
 * INN field with an inline "Подтянуть из DaData" button. Hits the
 * server route /api/dadata/party with the current INN and forwards
 * the resolved party to onParty(). The route enforces auth and the
 * settings.use_dadata permission.
 */
export const InnInput = forwardRef<HTMLInputElement, InnInputProps>(
  function InnInput(
    { value, onChange, onParty, disabled, placeholder, id, hideLookupButton },
    ref
  ) {
    const [loading, setLoading] = useState(false);

    const cleaned = value.replace(/\D/g, "");
    const canLookup = cleaned.length === 10 || cleaned.length === 12;

    const onLookup = async () => {
      if (!canLookup || disabled) return;
      setLoading(true);
      try {
        const res = await fetch("/api/dadata/party", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inn: cleaned }),
        });
        const json = (await res.json()) as
          | { party: ResolvedParty }
          | { error: string };

        if (!res.ok) {
          const message = "error" in json ? json.error : "Ошибка DaData";
          toast.error(message);
          return;
        }

        if ("party" in json && json.party) {
          onParty?.(json.party);
          toast.success(
            json.party.isActive
              ? "Данные подтянуты из DaData"
              : "Данные подтянуты, но юрлицо помечено как неактивное"
          );
        }
      } catch {
        toast.error("Не удалось обратиться к DaData");
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="flex items-stretch gap-2">
        <Input
          ref={ref}
          id={id}
          inputMode="numeric"
          pattern="\d*"
          placeholder={placeholder ?? "ИНН (10 или 12 цифр)"}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          disabled={disabled}
          maxLength={12}
        />
        {!hideLookupButton && (
          <Button
            type="button"
            variant="secondary"
            onClick={onLookup}
            disabled={!canLookup || loading || disabled}
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Из DaData
          </Button>
        )}
      </div>
    );
  }
);
