import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCachedUser,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { loadAdditional } from "./actions";
import { AdditionalClient } from "./additional-client";
import { SalesNoAccess } from "../_components/sales-no-access";

export const metadata: Metadata = { title: "Допродажи" };

export default async function AdditionalPage() {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissionChecker())("sales.view_shifts"))
    return <SalesNoAccess page="Допродажи" />;
  const data = await loadAdditional();
  return <AdditionalClient key={data.venueId} initial={data} />;
}
