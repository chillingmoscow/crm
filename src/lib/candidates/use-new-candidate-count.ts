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
    const refresh = async (notifyList = false) => {
      const current = ++request;
      try {
        const next = await countNewCandidates();
        if (!cancelled && request === current) {
          setCount(next);
          if (next !== lastCount) {
            lastCount = next;
            if (notifyList) window.dispatchEvent(new Event("candidates:incoming"));
          }
        }
      } catch {
        /* Keep the last confirmed count while offline. */
      }
    };
    let notifyOnRefresh = false;
    const schedule = (notifyList = false) => {
      notifyOnRefresh ||= notifyList;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const notify = notifyOnRefresh;
        notifyOnRefresh = false;
        void refresh(notify);
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
        () => {
          window.dispatchEvent(new Event("candidates:incoming"));
          schedule();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "candidates",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new;
          if (typeof row.id === "string" && typeof row.revision === "number" && typeof row.status === "string")
            window.dispatchEvent(new CustomEvent("candidates:row-updated", { detail: { id: row.id, revision: row.revision, status: row.status } }));
          schedule();
        },
      )
      // The default replica identity omits account_id on DELETE. Only refresh the scoped count.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "candidates" },
        () => { window.dispatchEvent(new Event("candidates:incoming")); schedule(); },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh(true);
      });
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 30000);
    const onFocus = () => schedule(true);
    const onChanged = () => schedule();
    window.addEventListener("focus", onFocus);
    window.addEventListener("candidates:changed", onChanged);
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("candidates:changed", onChanged);
      void client.removeChannel(channel);
    };
  }, [accountId, enabled, initialCount, client]);
  return enabled ? count : 0;
}
