"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import tabStyle from "@/components/shared/workspace-tabs.module.css";

/** Вкладки представления «Обзор / По страницам» (DS → «Вкладки»): вид в
 *  адресе (`?view=pages`), период сохраняется. */
export function KbOverviewViewTabs({ view }: { view: "overview" | "pages" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Tabs
      value={view}
      className={tabStyle.tabs}
      onValueChange={(next) => {
        const query = new URLSearchParams(params.toString());
        if (next === "pages") query.set("view", "pages");
        else query.delete("view");
        query.delete("sort");
        const qs = query.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    >
      <TabsList aria-label="Вид обзора">
        <TabsTrigger value="overview">Обзор</TabsTrigger>
        <TabsTrigger value="pages">По страницам</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
