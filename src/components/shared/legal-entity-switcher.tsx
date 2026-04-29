"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LegalEntityPicker } from "@/components/finance/legal-entity-picker";
import { setActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";

type LegalEntity = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type Props = {
  legalEntities: LegalEntity[];
  activeLegalEntityId: string | null;
};

/**
 * Header switcher for the Finance block. Lives in `/finance/layout.tsx`.
 *
 * Visibility rule: hidden when the account has fewer than 2 legal
 * entities (nothing to switch). When 2+, the user can pick one to
 * scope finance views, or "Все юрлица" (cookie cleared) to see
 * everything.
 *
 * The selection is persisted in an httpOnly cookie via
 * setActiveFinanceLegalEntityId; pages read it server-side via
 * getActiveFinanceLegalEntityId.
 */
export function LegalEntitySwitcher({ legalEntities, activeLegalEntityId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (legalEntities.length < 2) return null;

  const handleChange = (next: string | null) => {
    startTransition(async () => {
      const { error } = await setActiveFinanceLegalEntityId(next);
      if (error) {
        toast.error(error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="w-64">
      <LegalEntityPicker
        legalEntities={legalEntities}
        value={activeLegalEntityId}
        onChange={handleChange}
        allowClear
        placeholder="Все юрлица"
        ariaLabel="Активное юрлицо"
        disabled={isPending}
      />
    </div>
  );
}
