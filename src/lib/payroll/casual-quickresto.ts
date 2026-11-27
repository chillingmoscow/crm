import "server-only";
import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { decryptSecret } from "@/lib/integrations/crypto";
import {
  getConnection,
  withBackOfficeSession,
} from "@/app/(dashboard)/inventory/actions-shared";
import {
  callQuickRestoBackOfficeData,
  buildQuickRestoBackOfficeOrigin,
  quickRestoFetch,
} from "@/lib/integrations/quickresto/client";
import { runProvisionStep, type ProvisionStep } from "../candidates/provision-state";
import { splitCasualName } from "./casual-name";

// A casual worker gets only a Quick Resto employee (name, role, PIN) and the
// warehouse links of the venue. No guest, bonus account or chats: those belong
// to the hire of a staff member (src/lib/candidates/provision.ts).
type Obj = Record<string, unknown>;
type Ledger = {
  first_name?: string;
  last_name?: string;
  complete?: boolean;
  steps?: Record<string, ProvisionStep>;
};
type Claim = {
  id: string;
  account_id: string;
  venue_id: string;
  name: string;
  role_id: string | null;
  model_id: string | null;
  quickresto_id: number | null;
  quickresto_pin: string | null;
  provisioning: Ledger | null;
};
const employeeClass = "ru.edgex.quickresto.modules.personnel.employee.Employee";
const storeClass = "ru.edgex.quickresto.modules.warehouse.store.Store";
const checked = <T>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) {
    if (/payroll_employees_venue_id_quickresto_id_key/.test(r.error.message))
      throw new Error("Этот сотрудник Quick Resto уже привязан к другой записи в зарплате");
    throw new Error(r.error.message);
  }
  return r.data as T;
};
const object = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const entity = (value: unknown) => {
  const v = object(value);
  const data = object(v.data);
  const row = Number.isSafeInteger(data.id) ? data : v;
  if (!Number.isSafeInteger(row.id))
    throw new Error("Quick Resto не подтвердил создание записи");
  return row;
};
const fullName = (row: Obj) =>
  String([row.firstName, row.lastName].filter(Boolean).join(" ") || row.fullName || "")
    .trim()
    .toLocaleLowerCase("ru");

export async function provisionCasualQuickResto(employeeId: string): Promise<{ pin: string }> {
  const db = asLooseDb(createAdminClient());
  const claim = checked(
    await db.rpc("payroll_casual_claim_quickresto", { p_employee_id: employeeId }),
  ) as Claim | null;
  if (!claim)
    throw new Error("Заведение в Quick Resto уже выполняется. Обновите список через несколько секунд");
  const ledger: Ledger = claim.provisioning ?? {};
  const steps = (ledger.steps ??= {});
  const save = async (extra: Obj = {}) => {
    checked(
      await db
        .from("payroll_employees")
        .update({
          quickresto_provisioning: ledger,
          quickresto_lease_until: new Date(Date.now() + 240000).toISOString(),
          ...extra,
        })
        .eq("id", claim.id),
    );
  };
  try {
    if (ledger.complete && claim.quickresto_id && claim.quickresto_pin) {
      await save({ quickresto_lease_until: null });
      return { pin: claim.quickresto_pin };
    }
    // Имя из формы заведения; если его нет в журнале (запись пришла из Quick
    // Resto ещё до кодов Sheerly и уже связана со старым сотрудником кассы) —
    // по имени разового в Sheerly.
    const named = splitCasualName(claim.name ?? "", ledger);
    const firstName = named.firstName.trim(), lastName = named.lastName.trim();
    if (!firstName || !lastName) throw new Error("Укажите имя и фамилию");
    if (!claim.role_id) throw new Error("У разового не указана должность");
    const settings = checked(
      await db
        .from<{ store_ids: number[]; master_store_ids: number[]; tips_uri: string | null }>(
          "candidate_employment_settings",
        )
        .select("store_ids,master_store_ids,tips_uri")
        .eq("account_id", claim.account_id)
        .eq("venue_id", claim.venue_id)
        .maybeSingle(),
    );
    if (!settings) throw new Error("Укажите склады Quick Resto в настройках найма");
    const connection = await getConnection(claim.account_id);
    if (!connection) throw new Error("Подключите Quick Resto");
    const model = claim.model_id
      ? checked(
          await db
            .from<{ quickresto_role_id: number | null }>("payroll_models")
            .select("quickresto_role_id")
            .eq("id", claim.model_id)
            .maybeSingle(),
        )
      : null;
    const roleLink = checked(
      await db
        .from<{ external_id: string }>("external_entity_links")
        .select("external_id")
        .eq("account_id", claim.account_id)
        .eq("provider", "quickresto")
        .eq("entity_type", "role")
        .eq("local_id", claim.role_id)
        .maybeSingle(),
    );
    const qrRole = Number(model?.quickresto_role_id ?? roleLink?.external_id);
    if (!Number.isSafeInteger(qrRole) || qrRole < 1)
      throw new Error("Свяжите должность с должностью Quick Resto");

    const call = (path: string, query: Record<string, string | number> = {}, body?: Obj) =>
      withBackOfficeSession({
        connection,
        admin: db,
        run: (authorization) =>
          callQuickRestoBackOfficeData<Obj>({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            path,
            query,
            ...(body ? { body } : {}),
          }),
      });
    const rows = async (path: string, query: Record<string, string | number> = {}) => {
      const all: Obj[] = [];
      for (let start = 0; start < 20000; start += 200) {
        const r = await call(path, { ...query, start, count: 200 });
        if (!Array.isArray(r.ds))
          throw new Error("Quick Resto вернул неполный список для проверки повторов");
        const page = r.ds
          .map((x) => object(object(x).object))
          .filter((x) => Number.isSafeInteger(x.id));
        all.push(...page);
        const total = Number(object(r.utilityData).totalCount);
        if (Number.isFinite(total) && total >= 0 && start + page.length >= total) return all;
        if (page.length < 200) {
          if (Number.isFinite(total) && total > start + page.length)
            throw new Error("Quick Resto вернул неполный список");
          return all;
        }
      }
      throw new Error("Слишком большой список Quick Resto: нужна проверка вручную");
    };
    const createEmployee = async (body: Obj) => {
      const password = decryptSecret({
        encrypted: connection.password_encrypted,
        iv: connection.password_iv,
        tag: connection.password_tag,
      });
      const url = new URL(
        "/platform/online/api/create",
        buildQuickRestoBackOfficeOrigin({
          layerName: connection.login,
          baseUrl: connection.backoffice_base_url,
        }),
      );
      url.searchParams.set("moduleName", "personnel.employee");
      url.searchParams.set("className", employeeClass);
      const response = await quickRestoFetch(
        url.toString(),
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${connection.login}:${password}`).toString("base64"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
          redirect: "manual",
        },
        { retryNetwork: false },
      );
      if (!response.ok)
        throw new Error(
          `Quick Resto не подтвердил запись (HTTP ${response.status}). Проверьте результат перед повтором`,
        );
      return entity(await response.json());
    };
    const step = (key: string, create: () => Promise<Obj>, recover: () => Promise<Obj | null>) =>
      runProvisionStep({
        ledger: steps,
        key,
        save: () => save(),
        create: async () => entity(await create()),
        recover,
      });

    // Created earlier but the PIN was not recorded: read it back. A linked
    // employee that is gone from Quick Resto (deleted or missing) is not
    // reused — the worker gets a new one, otherwise the code would open
    // nothing. A live employee without a readable PIN is an error: creating a
    // second one would duplicate the person in the till.
    // Список сотрудников кассы — один раз на проверку привязки и подбор PIN:
    // каждый проход — несколько запросов по 200 записей подряд.
    let staffList: Promise<Obj[]> | null = null;
    const allEmployees = () => (staffList ??= rows("personnel.employee/select", { showDeleted: "true" }));
    if (claim.quickresto_id && !steps.employee) {
      const existing = (await allEmployees()).find(
        (e) => Number(e.id) === claim.quickresto_id,
      );
      if (existing && existing.deleted !== true) {
        const pin = String(existing.pin ?? "");
        if (!/^\d{4}$/.test(pin)) throw new Error("Не удалось прочитать PIN сотрудника в Quick Resto");
        steps.employee = { state: "done", id: claim.quickresto_id, pin };
        await save();
      }
    }
    if (!steps.employee?.pin) {
      const used = new Set((await allEmployees()).map((e) => String(e.pin ?? "")));
      let pin = "";
      for (let i = 0; i < 100 && !pin; i++) {
        const p = String(randomInt(1000, 10000));
        if (!used.has(p)) pin = p;
      }
      if (!pin) throw new Error("Не удалось подобрать свободный PIN");
      steps.employee = { state: "prepared", pin };
      await save();
    }
    const pin = steps.employee.pin!;
    const desiredName = `${firstName} ${lastName}`.toLocaleLowerCase("ru");
    const qrEmployeeId = await step(
      "employee",
      () =>
        createEmployee({
          className: employeeClass,
          systemEmployee: "Custom",
          ...(settings.tips_uri ? { tipsUri: settings.tips_uri } : {}),
          firstName,
          lastName,
          language: { id: 2, className: "ru.edgex.platform.service.language.Language" },
          role: {
            id: qrRole,
            className: "ru.edgex.platform.service.user.Role",
            systemRole: "Custom",
            frontOfficeUser: true,
            system: false,
          },
          pin,
        }),
      async () => {
        const matches = (await rows("personnel.employee/select", { showDeleted: "true" })).filter(
          (e) => String(e.pin ?? "") === pin && fullName(e) === desiredName,
        );
        return matches.length === 1 ? matches[0] : null;
      },
    );
    // Link right away: marks made with the new PIN must reach this worker.
    await save({ quickresto_id: qrEmployeeId, quickresto_pin: pin });

    const role = checked(
      await db.from<{ name: string }>("roles").select("name").eq("id", claim.role_id).single(),
    );
    const stores = [
      ...new Set([
        ...settings.store_ids,
        ...(/мастер/i.test(role.name) ? settings.master_store_ids : []),
      ]),
    ];
    for (const storeId of stores) {
      const key = `store_${storeId}`;
      const query = { ownerContextId: storeId, ownerContextClassName: storeClass };
      const find = async () =>
        (await rows("warehouse.store.employee/select", query)).find(
          (e) => Number(object(e.employee).id) === qrEmployeeId,
        ) ?? null;
      if (steps[key]?.state !== "done") {
        const current = await find();
        if (current) {
          steps[key] = { state: "done", id: Number(current.id) };
          await save();
          continue;
        }
      }
      await step(
        key,
        () =>
          call("warehouse.store.employee/create", query, {
            employee: { id: qrEmployeeId, className: employeeClass },
            deleted: false,
            permanent: false,
            className: "ru.edgex.quickresto.modules.warehouse.store.employee.StoreEmployeeLink",
          }),
        find,
      );
    }
    ledger.complete = true;
    await save({ quickresto_lease_until: null });
    return { pin };
  } catch (e) {
    await db
      .from("payroll_employees")
      .update({ quickresto_lease_until: null })
      .eq("id", claim.id);
    throw e instanceof Error ? e : new Error("Не удалось завести сотрудника в Quick Resto");
  }
}
