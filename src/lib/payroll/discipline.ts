/** Mirrors the persisted automatic lateness rule; preview only, no accounting writes. */
export function previewLateness(
  elapsedSeconds: number,
  rule: {
    enabled: boolean;
    late_enabled: boolean;
    late_grace: number;
    late_step: number;
    late_amount: number;
    late_max: number;
  },
) {
  const minutes = Math.max(0, Math.round(elapsedSeconds / 60));
  if (!rule.enabled || !rule.late_enabled)
    return { kind: "disabled" as const, minutes, amount: 0 };
  if (!minutes) return { kind: "on_time" as const, minutes, amount: 0 };
  if (minutes <= rule.late_grace)
    return { kind: "warning" as const, minutes, amount: 0 };
  return {
    kind: "deduction" as const,
    minutes,
    amount: Math.min(
      Math.ceil(minutes / Math.max(1, rule.late_step)) * rule.late_amount,
      rule.late_max,
    ),
  };
}
