"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countNewCandidates } from "@/app/(dashboard)/people/candidates/actions";

export function useNewCandidateCount(
  accountId: string | null,
  enabled: boolean,
  initialCount: number,
) {
  const [count, setCount] = useState(initialCount);
  const client = useMemo(() => createClient(), []);
  useEffect(() => {
    setCount(enabled ? initialCount : 0);
    if (!enabled || !accountId) return;
    let cancelled = false,
      lastCount = initialCount,
      timer: ReturnType<typeof setTimeout> | undefined,
      request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const next = await countNewCandidates();
        if (!cancelled && request === current) {
          setCount(next);
          if (next !== lastCount) {
            lastCount = next;
            window.dispatchEvent(new Event("candidates:incoming"));
          }
        }
      } catch {
        /* Keep the last confirmed count while offline. */
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 150);
    };
    const channel = client
      .channel(`candidate-count:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "candidates",
          filter: `account_id=eq.${accountId}`,
        },
        schedule,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "candidates",
          filter: `account_id=eq.${accountId}`,
        },
        schedule,
      )
      // The default replica identity omits account_id on DELETE. Only refresh the scoped count.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "candidates" },
        schedule,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    window.addEventListener("focus", schedule);
    window.addEventListener("candidates:changed", schedule);
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("candidates:changed", schedule);
      void client.removeChannel(channel);
    };
  }, [accountId, enabled, initialCount, client]);
  return enabled ? count : 0;
}
