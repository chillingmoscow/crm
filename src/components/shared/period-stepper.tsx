import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const periodTriggerClass =
  "inline-flex h-full min-w-0 items-center gap-2 border-x border-brand/15 px-2.5 text-[13px] font-medium text-brand hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function PeriodStepper({ children, previous, next, onPrevious, onNext, previousDisabled = false, nextDisabled = false }: {
  children: ReactNode;
  previous: string;
  next: string;
  onPrevious: () => void;
  onNext: () => void;
  /** Край допустимого диапазона: стрелка остаётся на месте, но не нажимается. */
  previousDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const arrow = "grid h-full w-8 shrink-0 place-items-center text-brand hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:text-brand/35";
  return (
    <div className="inline-flex h-9 max-w-full items-center overflow-hidden rounded-lg border border-brand/20 bg-brand/[0.06]">
      <button type="button" aria-label={previous} className={arrow} disabled={previousDisabled} onClick={onPrevious}>
        <ChevronLeft size={16} />
      </button>
      {children}
      <button type="button" aria-label={next} className={arrow} disabled={nextDisabled} onClick={onNext}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
