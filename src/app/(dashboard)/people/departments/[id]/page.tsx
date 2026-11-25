import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createClient,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { listAuditEvents } from "@/lib/audit/list";
import { unwrapAction } from "@/lib/actions/result";
import { getDepartment } from "../actions";
import {
  loadStockRules,
  type StockRuleData,
} from "@/app/(dashboard)/documents/writeoffs/rule-actions";
import {
  loadUpsellEditor,
  type UpsellEditorData,
} from "@/app/(dashboard)/sales/additional/actions";
import { DepartmentDetailPage } from "./_components/department-detail-page";

export const metadata: Metadata = { title: "Подразделение" };

export default async function DepartmentDetailServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  // Не идентификатор (например, `/people/departments/archive`) — сразу на
  // список. Иначе параллельные загрузчики ниже успевают споткнуться о такой id
  // и засорить журнал сервера ошибками проверки.
  if (!z.string().uuid().safeParse(id).success) redirect("/people/departments");
  const [user, supabase, can] = await Promise.all([
    getCachedUser(),
    createClient(),
    getCachedPermissionChecker(),
  ]);
  if (!user) redirect("/login");
  if (!can("people.view_roles")) redirect("/dashboard");
  const canManage = can("people.manage_roles");
  const canViewAudit = can("org.view_audit");

  // Всё, что можно, стартует сразу, а зависимое — как только готово то, от
  // чего оно зависит: на проде каждая последовательная волна запросов стоит
  // десятки миллисекунд, а раньше их было больше десяти. Чужое подразделение
  // отсекается проверкой ниже — до клиента его данные не доходят, а сами
  // загрузчики проверяют заведение и права (RLS, scope) независимо от неё.
  type AuditProfile = { id: string; first_name: string | null; last_name: string | null };
  type VenueRole = {
    id: string;
    name: string;
    code: string;
    icon: string | null;
    icon_color: string | null;
    venue_id: string | null;
    department_id: string | null;
  };
  // Promise.resolve — ради одного запроса: билдер Supabase отправляет запрос
  // на каждый свой `.then`, а у этого обещания три потребителя.
  const venueIdPromise = Promise.resolve(supabase.rpc("get_active_venue_id")).then(
    ({ data }) => (data as string | null) ?? null,
  );
  const departmentPromise = getDepartment(id);

  const [
    activeVenueId,
    { department, roles, heads },
    allRoles,
    auditProfiles,
    auditResult,
    stockRules,
    upsellEditor,
  ] = await Promise.all([
    venueIdPromise,
    departmentPromise,
    // Stage D: список ролей для прикрепления — venue-scoped активного venue.
    // System owner (venue_id NULL) исключаем — он не может состоять в dept.
    venueIdPromise.then(async (venueId): Promise<VenueRole[]> => {
      if (!venueId) return [];
      const { data } = await supabase
        .from("roles")
        .select("id, name, code, icon, icon_color, venue_id, department_id")
        .eq("venue_id", venueId)
        .order("name");
      return data ?? [];
    }),
    // Профили created_by / updated_by для info-popover — паттерн из
    // role-detail-page.tsx.
    departmentPromise.then(async ({ department: d }): Promise<AuditProfile[]> => {
      const ids = Array.from(
        new Set(
          [d?.created_by ?? null, d?.updated_by ?? null].filter(
            (x): x is string => x !== null,
          ),
        ),
      );
      if (!ids.length) return [];
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", ids);
      return (data as AuditProfile[] | null) ?? [];
    }),
    canViewAudit
      ? listAuditEvents({ entityType: "department", entityId: id })
      : Promise.resolve({ events: [], hasMore: false, error: null }),
    // Нет права или данные не загрузились — блок «Недостача» и вкладка
    // «Допродажи» просто скрыты. Правила недостачи — заведения, к которому
    // относится подразделение; проверка ниже требует, чтобы это было активное.
    can("inventory.view_results")
      ? venueIdPromise
          .then((venueId) => (venueId ? loadStockRules(venueId) : null))
          .then((r): StockRuleData | null => (r ? unwrapAction(r) : null))
          .catch(() => null)
      : Promise.resolve(null),
    // Правила допродаж — для тех, кто настраивает продажи.
    can("sales.view_shifts") && can("sales.configure_shifts")
      ? loadUpsellEditor(id)
          .then((r): UpsellEditorData | null => unwrapAction(r))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!department) redirect("/people/departments");
  if (department.venue_id !== activeVenueId) {
    redirect("/people/departments");
  }

  const profileMap = new Map(auditProfiles.map((p) => [p.id, p]));

  const formatProfile = (uid: string | null): string | null => {
    if (!uid) return null;
    const p = profileMap.get(uid);
    if (!p) return null;
    const first = (p.first_name ?? "").trim();
    const last = (p.last_name ?? "").trim();
    if (!first && !last) return null;
    return last ? `${first} ${last.charAt(0)}.`.trim() : first;
  };

  return (
    <DepartmentDetailPage
      department={department}
      initialRoles={roles}
      initialHeads={heads}
      allRoles={allRoles}
      canManage={Boolean(canManage)}
      canViewAudit={Boolean(canViewAudit)}
      initialAuditEvents={auditResult.events}
      initialAuditHasMore={auditResult.hasMore}
      createdByName={formatProfile(department.created_by)}
      updatedByName={formatProfile(department.updated_by)}
      stockRules={stockRules}
      upsellEditor={upsellEditor}
      initialTab={tab === "upsell" && upsellEditor ? "upsell" : "main"}
    />
  );
}
