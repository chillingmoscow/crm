"use client";

import { formatRub } from "@/components/shared/money";
import { officialNet, officialTax } from "@/lib/payroll/official";

/** «На руки 69 600 ₽ · НДФЛ 10 400 ₽» под полем оклада, пересчёт на лету. */
export function OfficialTaxHint({ gross }: { gross: number | null }) {
  if (!gross || gross <= 0) return null;
  return (
    <span className="tabular-nums">
      На руки {formatRub(officialNet(gross), { fraction: "auto" })} · НДФЛ {formatRub(officialTax(gross))}
    </span>
  );
}
