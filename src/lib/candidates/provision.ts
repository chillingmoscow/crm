import "server-only";
import { createHash, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  getConnection,
  withBackOfficeSession,
} from "@/app/(dashboard)/inventory/actions-shared";
import {
  callQuickRestoBackOfficeData,
  buildQuickRestoBackOfficeOrigin,
  quickRestoFetch,
} from "@/lib/integrations/quickresto/client";
import { normalizePhone } from "./schema";
import { runProvisionStep, type ProvisionStep } from "./provision-state";
type Obj = Record<string, unknown>;
type Hire = {
  id: string;
  account_id: string;
  candidate_id: string;
  target_user_id: string;
  existing_user: boolean;
  actor_id: string;
  state: string;
  input: {
    venue_id: string;
    role_id: string;
    first_name: string;
    last_name: string;
    employment_date: string;
    attendance_source: string;
  };
  provisioning: Record<string, ProvisionStep>;
};
const checked = <T>(r: {
  data: T | null;
  error: { message: string } | null;
}) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};
const object = (x: unknown): Obj =>
  x && typeof x === "object" ? (x as Obj) : {};
const entity = (value: unknown) => {
  const v = object(value);
  const data = object(v.data);
  const row = Number.isSafeInteger(data.id) ? data : v;
  if (!Number.isSafeInteger(row.id))
    throw new Error("Quick Resto не подтвердил создание записи");
  return row;
};
const name = (row: Obj) =>
  String(
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      row.fullName ||
      "",
  )
    .trim()
    .toLocaleLowerCase("ru");
export async function provisionCandidateHire(hireId: string) {
  const admin = createAdminClient(),
    db = asLooseDb(admin);
  const h = checked(
    await db.rpc("candidate_claim_hire", { p_hire: hireId }),
  ) as Hire | null;
  if (!h) {
    const existing = checked(
      await db
        .from<{ state: string }>("candidate_hires")
        .select("state")
        .eq("id", hireId)
        .single(),
    );
    if (existing.state === "complete") return;
    throw new Error(
      "Оформление уже выполняется. Обновите карточку через несколько секунд",
    );
  }
  const save = async () => {
    checked(
      await db
        .from("candidate_hires")
        .update({
          provisioning: h.provisioning,
          lease_until: new Date(Date.now() + 240000).toISOString(),
        })
        .eq("id", h.id),
    );
  };
  try {
    const settings = checked(
      await db
        .from<{
          store_ids: number[];
          master_store_ids: number[];
          staff_group_id: number;
          tips_uri: string | null;
          bonus_account_type_id: number;
          office_pool_initialized: boolean;
        }>("candidate_employment_settings")
        .select("*")
        .eq("account_id", h.account_id)
        .eq("venue_id", h.input.venue_id)
        .single(),
    );
    if (!settings.office_pool_initialized)
      throw new Error("Перенесите занятые коды замка в настройках найма");
    // Verify encryption is configured before creating anything in Quick Resto.
    encryptSecret("configuration-check");
    const connection = await getConnection(h.account_id);
    if (!connection) throw new Error("Подключите Quick Resto");
    const model = checked(
      await db
        .from<{ quickresto_role_id: number | null }>("payroll_models")
        .select("quickresto_role_id")
        .eq("account_id", h.account_id)
        .eq("venue_id", h.input.venue_id)
        .eq("role_id", h.input.role_id)
        .eq("is_role_default", true)
        .eq("archived", false)
        .single(),
    );
    const roleLink = checked(
      await db
        .from<{ external_id: string }>("external_entity_links")
        .select("external_id")
        .eq("account_id", h.account_id)
        .eq("provider", "quickresto")
        .eq("entity_type", "role")
        .eq("local_id", h.input.role_id)
        .maybeSingle(),
    );
    const qrRole = Number(model.quickresto_role_id ?? roleLink?.external_id);
    if (!Number.isSafeInteger(qrRole) || qrRole < 1)
      throw new Error("Свяжите выбранную должность с должностью Quick Resto");
    const candidate = checked(
      await db
        .from<{ phone: string | null }>("candidates")
        .select("phone")
        .eq("id", h.candidate_id)
        .eq("account_id", h.account_id)
        .single(),
    );
    const phone = normalizePhone(candidate.phone ?? "");
    if (!phone)
      throw new Error("Для гостя Quick Resto нужен телефон кандидата");
    const read = async (
      path: string,
      query: Record<string, string | number> = {},
    ) =>
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
          }),
      });
    const rows = async (
      path: string,
      query: Record<string, string | number> = {},
    ) => {
      const all: Obj[] = [];
      for (let start = 0; start < 20000; start += 200) {
        const r = await read(path, { ...query, start, count: 200 });
        if (!Array.isArray(r.ds))
          throw new Error(
            "Quick Resto вернул неполный список для проверки повторов",
          );
        const page = r.ds
          .map((x) => object(object(x).object))
          .filter((x) => Number.isSafeInteger(x.id));
        all.push(...page);
        const total = Number(object(r.utilityData).totalCount);
        if (
          Number.isFinite(total) &&
          total >= 0 &&
          start + page.length >= total
        )
          return all;
        if (page.length < 200) {
          if (Number.isFinite(total) && total > start + page.length)
            throw new Error("Quick Resto вернул неполный список");
          return all;
        }
      }
      throw new Error(
        "Слишком большой список Quick Resto: нужна проверка вручную",
      );
    };
    const postData = async (
      path: string,
      body: Obj,
      query: Record<string, string | number> = {},
    ) =>
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
            body,
          }),
      });
    const password = decryptSecret({
      encrypted: connection.password_encrypted,
      iv: connection.password_iv,
      tag: connection.password_tag,
    });
    const basicCreate = async (
      moduleName: string,
      className: string,
      body: Obj,
    ) => {
      const url = new URL(
        "/platform/online/api/create",
        buildQuickRestoBackOfficeOrigin({
          layerName: connection.login,
          baseUrl: connection.backoffice_base_url,
        }),
      );
      url.searchParams.set("moduleName", moduleName);
      url.searchParams.set("className", className);
      const response = await quickRestoFetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${connection.login}:${password}`).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
      }, { retryNetwork: false });
      if (!response.ok)
        throw new Error(
          `Quick Resto не подтвердил запись (HTTP ${response.status}). Проверьте результат перед повтором`,
        );
      return entity(await response.json());
    };
    const readGuest = async (id: number) => {
      const url = new URL(
        "/platform/online/api/read",
        buildQuickRestoBackOfficeOrigin({
          layerName: connection.login,
          baseUrl: connection.backoffice_base_url,
        }),
      );
      url.searchParams.set("moduleName", "crm.customer");
      url.searchParams.set(
        "className",
        "ru.edgex.quickresto.modules.crm.customer.CrmCustomer",
      );
      url.searchParams.set("objectId", String(id));
      const response = await quickRestoFetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(`${connection.login}:${password}`).toString("base64"),
        },
        signal: AbortSignal.timeout(20000),
        redirect: "manual",
      });
      if (!response.ok)
        throw new Error(`Не удалось проверить гостя Quick Resto (HTTP ${response.status})`);
      return entity(await response.json());
    };
    const desiredName = `${h.input.first_name} ${h.input.last_name}`
      .trim()
      .toLocaleLowerCase("ru");
    const step = (
      key: string,
      create: () => Promise<Obj>,
      recover: () => Promise<Obj | null>,
    ) =>
      runProvisionStep({
        ledger: h.provisioning,
        key,
        save,
        create: async () => entity(await create()),
        recover,
      });
    const employeeClass =
      "ru.edgex.quickresto.modules.personnel.employee.Employee";
    const customerClass =
      "ru.edgex.quickresto.modules.crm.customer.CrmCustomer";
    // Reuse a deliberately selected existing member only if its external link is known.
    let employeeId: number;
    const existingLink = checked(
      await db
        .from<{ external_id: string }>("external_entity_links")
        .select("external_id")
        .eq("account_id", h.account_id)
        .eq("provider", "quickresto")
        .eq("entity_type", "staff")
        .eq("local_id", h.target_user_id)
        .maybeSingle(),
    );
    if (h.existing_user && !existingLink)
      throw new Error("У выбранного сотрудника нет связи с Quick Resto");
    if (existingLink) {
      employeeId = Number(existingLink.external_id);
      h.provisioning.employee = { state: "done", id: employeeId };
      await save();
    } else {
      if (!h.provisioning.employee?.pin) {
        const employees = await rows("personnel.employee/select", {
          showDeleted: "true",
        });
        const used = new Set(employees.map((e) => String(e.pin ?? "")));
        let pin = "";
        for (let i = 0; i < 100; i++) {
          const p = String(randomInt(1000, 10000));
          if (!used.has(p)) {
            pin = p;
            break;
          }
        }
        if (!pin) throw new Error("Не удалось подобрать свободный PIN");
        h.provisioning.employee = { state: "prepared", pin };
        await save();
      }
      employeeId = await step(
        "employee",
        () =>
          basicCreate("personnel.employee", employeeClass, {
            className: employeeClass,
            systemEmployee: "Custom",
            ...(settings.tips_uri ? { tipsUri: settings.tips_uri } : {}),
            firstName: h.input.first_name,
            lastName: h.input.last_name,
            language: {
              id: 2,
              className: "ru.edgex.platform.service.language.Language",
            },
            role: {
              id: qrRole,
              className: "ru.edgex.platform.service.user.Role",
              systemRole: "Custom",
              frontOfficeUser: true,
              system: false,
            },
            pin: h.provisioning.employee.pin,
          }),
        async () => {
          const matches = (
            await rows("personnel.employee/select", { showDeleted: "true" })
          ).filter(
            (e) =>
              String(e.pin ?? "") === h.provisioning.employee.pin &&
              name(e) === desiredName,
          );
          return matches.length === 1 ? matches[0] : null;
        },
      );
    }
    // Role-specific warehouse access is configured per venue, never across accounts.
    const role = checked(
      await db
        .from<{ name: string }>("roles")
        .select("name")
        .eq("id", h.input.role_id)
        .single(),
    );
    const stores = [
      ...new Set([
        ...settings.store_ids,
        ...(/мастер/i.test(role.name) ? settings.master_store_ids : []),
      ]),
    ];
    for (const storeId of stores) {
      const key = `store_${storeId}`;
      const query = {
        ownerContextId: storeId,
        ownerContextClassName:
          "ru.edgex.quickresto.modules.warehouse.store.Store",
      };
      const current = (
        await rows("warehouse.store.employee/select", query)
      ).find((e) => Number(object(e.employee).id) === employeeId);
      if (current) {
        h.provisioning[key] = { state: "done", id: Number(current.id) };
        await save();
        continue;
      }
      await step(
        key,
        async () =>
          postData(
            "warehouse.store.employee/create",
            {
              employee: { id: employeeId, className: employeeClass },
              deleted: false,
              permanent: false,
              className:
                "ru.edgex.quickresto.modules.warehouse.store.employee.StoreEmployeeLink",
            },
            query,
          ),
        async () =>
          (await rows("warehouse.store.employee/select", query)).find(
            (e) => Number(object(e.employee).id) === employeeId,
          ) ?? null,
      );
    }
    const guestMatches = async () => {
      const possible = (await rows("crm.customer/select")).filter(
        (e) => name(e) === desiredName,
      );
      if (possible.length > 20)
        throw new Error(
          "Найдено слишком много гостей с этим именем. Нужна проверка",
        );
      const complete: Obj[] = [];
      for (const candidate of possible)
        complete.push(await readGuest(Number(candidate.id)));
      const matches = complete.filter(
        (e) =>
          (Array.isArray(e.tokens) && e.tokens.some((t) => object(t).type === "phone" && normalizePhone(String(object(t).key ?? "")) === phone)) ||
          (Array.isArray(e.contactMethods) && e.contactMethods.some((t) => object(t).type === "phoneNumber" && normalizePhone(String(object(t).value ?? "")) === phone)),
      );
      if (matches.length > 1)
        throw new Error(
          "Найдено несколько гостей с этим именем и телефоном. Нужна проверка",
        );
      return matches[0] ?? null;
    };
    if (!h.provisioning.guest) {
      const existing = await guestMatches();
      if (existing) {
        h.provisioning.guest = { state: "done", id: Number(existing.id) };
        await save();
      }
    }
    const guestId = await step(
      "guest",
      () =>
        basicCreate("crm.customer", customerClass, {
          className: customerClass,
          firstName: h.input.first_name,
          lastName: h.input.last_name,
          customerGroup: { id: settings.staff_group_id },
        }),
      guestMatches,
    );
    const guest = await readGuest(guestId);
    if (Number(object(guest.customerGroup).id) !== settings.staff_group_id) {
      await step(
        "guest_group",
        () =>
          postData("crm.customer/update", {
            ...guest,
            customerGroup: { id: settings.staff_group_id },
          }),
        async () => {
          const row = await readGuest(guestId);
          return Number(object(row.customerGroup).id) ===
            settings.staff_group_id
            ? row
            : null;
        },
      );
    }
    // Contacts are separate child entities; nested tokens are silently ignored by QR.
    const contactQuery = { ownerContextId: guestId, ownerContextClassName: customerClass };
    const findPhone = async () => (await rows("crm.customer.contacts/select", contactQuery)).find(
      (contact) => contact.type === "phoneNumber" && normalizePhone(String(contact.value ?? "")) === phone,
    ) ?? null;
    const existingPhone = await findPhone();
    if (existingPhone) { h.provisioning.guest_phone = { state: "done", id: Number(existingPhone.id) }; await save(); }
    else await step("guest_phone", () => postData("crm.customer.contacts/create", {
      className: "ru.edgex.quickresto.modules.crm.customer.contacts.ContactMethod",
      type: "phoneNumber", value: `+${phone}`,
    }, contactQuery), findPhone);
    const accountQuery = {
      mode: "bonuses",
      ownerContextId: guestId,
      ownerContextClassName: customerClass,
    };
    const findBonus = async () => {
      const matches = (
        await rows("crm.accounting.account/select", accountQuery)
      ).filter(
        (e) =>
          Number(object(e.accountType).id) === settings.bonus_account_type_id &&
          !e.deleted,
      );
      if (matches.length > 1)
        throw new Error(
          "Найдено несколько бонусных счетов сотрудника. Нужна проверка",
        );
      return matches[0] ?? null;
    };
    if (!h.provisioning.bonus) {
      const existing = await findBonus();
      if (existing) {
        h.provisioning.bonus = { state: "done", id: Number(existing.id) };
        await save();
      }
    }
    await step(
      "bonus",
      () =>
        postData(
          "crm.accounting.account/create",
          {
            version: 0,
            accountState: "open",
            title: "Депозитный счет",
            hidden: false,
            deleted: false,
            permanent: false,
            accountBalance: {
              ledger: 0,
              available: 0,
              debitHold: 0,
              creditHold: 0,
            },
            className:
              "ru.edgex.quickresto.modules.crm.accounting.account.CustomerAccount",
            accountType: {
              id: settings.bonus_account_type_id,
              className:
                "ru.edgex.quickresto.modules.crm.accounting.account.type.CustomerAccountType",
            },
          },
          accountQuery,
        ),
      findBonus,
    );
    let door = checked(
      await db
        .from<{ id: string }>("staff_door_codes")
        .select("id")
        .eq("hire_id", h.id)
        .maybeSingle(),
    );
    for (let attempt = 0; !door && attempt < 100; attempt++) {
      const code = String(randomInt(100000, 1000000));
      const r = await db.rpc("candidate_reserve_door", {
        p_hire: h.id,
        p_number: randomInt(100, 1000),
        p_hash: createHash("sha256").update(code).digest("hex"),
        p_secret: encryptSecret(code),
      });
      if (!r.error) door = { id: String(r.data) };
      else if (!/duplicate key|уникальн/i.test(r.error.message))
        throw new Error(r.error.message);
    }
    if (!door) throw new Error("Не удалось подобрать свободные данные замка");
    const auth = await admin.auth.admin.getUserById(h.target_user_id);
    if (!auth.data.user) {
      if (h.existing_user)
        throw new Error("Учётная запись сотрудника недоступна");
      const created = await admin.auth.admin.createUser({
        id: h.target_user_id,
        email: `candidate_${h.target_user_id.replace(/-/g, "")}@import.local`,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        app_metadata: { candidate_hire_id: h.id },
        user_metadata: { placeholder: true, created_by: h.actor_id },
      });
      if (created.error) throw new Error(created.error.message);
      if (created.data.user?.id !== h.target_user_id)
        throw new Error("Не удалось подтвердить идентификатор сотрудника");
    }
    checked(await db.rpc("candidate_finish_hire", { p_hire: h.id }));
    checked(
      await db
        .from("candidate_hires")
        .update({ lease_until: null, error: null })
        .eq("id", h.id),
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Не удалось оформить сотрудника";
    await db
      .from("candidate_hires")
      .update({ lease_until: null, error: message.slice(0, 1500) })
      .eq("id", h.id);
    throw new Error(message);
  }
}
