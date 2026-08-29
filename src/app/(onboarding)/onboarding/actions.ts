"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasCustomMailerConfig, sendInvitationEmail } from "@/lib/people/invitations/mailer";
import type { Json, VenueType, WorkingHours } from "@/types/database";
import { randomUUID } from "crypto";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { asLooseDb } from "@/lib/supabase/loose";
import { resolveDefaultVenueId } from "@/lib/inventory/default-venue";
import { storeVenueBindingPatch } from "@/lib/inventory/store-venue-binding";
import {
  asObject,
  groupName,
  isQuickRestoClass,
  num,
  productName,
  storeTitle,
  text,
} from "@/lib/integrations/quickresto/normalize";
import {
  loginQuickRestoBackOffice,
  listEmployees,
  listIngredientTreeItems,
  listStores,
  listRoles,
  listTableSchemes,
  readEmployee,
  readRole,
  readTableScheme,
  type QuickRestoEmployeeRead,
  type QuickRestoRole,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct,
  type QuickRestoTableScheme,
} from "@/lib/integrations/quickresto/client";

type LooseQueryResult = { data: unknown; error: { message: string } | null };
type LooseQueryBuilder = {
  then: PromiseLike<LooseQueryResult>["then"];
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  in: (column: string, values: unknown[]) => LooseQueryBuilder;
  is: (column: string, value: unknown) => LooseQueryBuilder;
  maybeSingle: () => Promise<LooseQueryResult>;
  single: () => Promise<LooseQueryResult>;
  insert: (values: unknown) => LooseQueryBuilder;
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQueryBuilder;
  update: (values: unknown) => LooseQueryBuilder;
  delete: () => LooseQueryBuilder;
};
type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
};

function asLooseClient(client: unknown): LooseSupabaseClient {
  return client as unknown as LooseSupabaseClient;
}

// Загрузка фото профиля в Supabase Storage (папка avatar/)
export async function uploadAvatar(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Не авторизован" };

  const file = formData.get("file") as File;
  if (!file) return { url: null, error: "Файл не выбран" };

  const ext = file.name.split(".").pop();
  const path = `${user.id}/avatar/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// Загрузка логотипа аккаунта/заведения в Supabase Storage (папка logo/)
export async function uploadLogo(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Не авторизован" };

  const file = formData.get("file") as File;
  if (!file) return { url: null, error: "Файл не выбран" };

  const ext = file.name.split(".").pop();
  const path = `${user.id}/logo/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true });

  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// Создание аккаунта и первого заведения (через stored procedure)
export async function createAccountAndVenue(data: {
  accountName: string;
  accountLogoUrl: string | null;
  venueName: string;
  venueType: VenueType;
  venueAddress: string;
  venuePhone: string;
  venueWebsite: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
  // Legal entity (added in stage 2). The wizard will start collecting these
  // in stage 2B; for now we accept them as optional and fall back to a stub
  // (legal_form='IP', name=accountName, no INN). The owner can edit the real
  // legal entity from /org/legal-entities afterwards.
  legalName?: string;
  legalForm?: "IP" | "OOO" | "AO" | "PAO" | "NKO" | "OTHER";
  legalInn?: string;
}): Promise<{ accountId: string | null; legalEntityId: string | null; venueId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { accountId: null, legalEntityId: null, venueId: null, error: "Не авторизован" };

  // complete_owner_onboarding is idempotent (migration 043): on retry
  // it returns the existing account_id / legal_entity_id / venue_id
  // without creating duplicates and back-fills venues.default_legal_entity_id
  // if it was NULL. Always route through it so every onboarding path —
  // first attempt or retry — produces a venue with a default legal entity.
  const { data: result, error } = await supabase.rpc("complete_owner_onboarding", {
    p_account_name:  data.accountName,
    p_account_logo:  data.accountLogoUrl ?? "",
    p_legal_name:    data.legalName ?? data.accountName,
    p_legal_form:    data.legalForm ?? "IP",
    p_legal_inn:     data.legalInn ?? "",
    p_venue_name:    data.venueName,
    p_venue_type:    data.venueType,
    p_venue_address: data.venueAddress,
    p_venue_phone:   data.venuePhone,
    p_venue_website: data.venueWebsite,
    p_currency:      data.currency,
    p_timezone:      data.timezone,
    p_working_hours: data.workingHours as unknown as Json,
  });

  if (error) return { accountId: null, legalEntityId: null, venueId: null, error: error.message };

  const rpcResult = result as { account_id: string; legal_entity_id: string; venue_id: string };
  return {
    accountId:     rpcResult.account_id,
    legalEntityId: rpcResult.legal_entity_id,
    venueId:       rpcResult.venue_id,
    error:         null,
  };
}

// Отправка приглашения сотруднику
export async function sendInvitation(data: {
  email: string;
  roleId: string;
  venueId: string;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const email = data.email.trim().toLowerCase();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const [{ data: venueRow }, { data: inviterProfile }, { data: roleRow }] = await Promise.all([
    supabase
      .from("venues")
      .select("name, accounts(name)")
      .eq("id", data.venueId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("roles")
      .select("name")
      .eq("id", data.roleId)
      .maybeSingle(),
  ]);

  if (!venueRow?.name) return { error: "Не удалось определить заведение для приглашения" };

  const accountName =
    ((venueRow.accounts as { name?: string } | null)?.name ?? null) ||
    null;
  const inviterName =
    [inviterProfile?.first_name, inviterProfile?.last_name]
      .filter(Boolean)
      .join(" ") || null;
  const roleName = roleRow?.name ?? null;

  // Keep one pending invite per email+venue to avoid ambiguous acceptance.
  await supabase
    .from("invitations")
    .delete()
    .eq("venue_id", data.venueId)
    .ilike("email", email)
    .eq("status", "pending");

  const { data: insertedInvitation, error: invError } = await supabase
    .from("invitations")
    .insert({
      venue_id:   data.venueId,
      email,
      role_id:    data.roleId,
      invited_by: user.id,
      status:     "pending",
    })
    .select("id")
    .single();

  if (invError || !insertedInvitation?.id) return { error: invError?.message ?? "Не удалось создать приглашение" };

  // Build redirect paths:
  //   - New users  → /set-password (create password first) → /invite?invitation=ID
  //   - Existing users → /invite?invitation=ID directly
  const inviteAcceptPath = `/invite?invitation=${insertedInvitation.id}`;
  const setPasswordPath  = `/set-password?next=${encodeURIComponent(inviteAcceptPath)}`;

  // Генерируем ссылку (invite для новых пользователей, magiclink для существующих)
  const adminClient = createAdminClient();
  const linkPayload = {
    venue_id: data.venueId,
    role_id: data.roleId,
    invitation_id: insertedInvitation.id,
    venue_name: venueRow.name,
    role_name: roleName,
  };
  const hasCustomMailer = hasCustomMailerConfig();

  // Fallback: if custom SMTP mailer is not configured, use built-in Supabase emails.
  // The `redirectTo` in Supabase emails is where the user lands after token verification.
  if (!hasCustomMailer) {
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: linkPayload,
      // New invited users need to create a password first
      redirectTo: `${siteUrl}${setPasswordPath}`,
    });

    if (inviteError) {
      const isExistingUserError = inviteError.message
        .toLowerCase()
        .includes("already been registered");

      if (!isExistingUserError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: inviteError.message };
      }

      const { error: otpError } = await adminClient.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          // Existing users skip set-password and go straight to invite acceptance
          emailRedirectTo: `${siteUrl}${inviteAcceptPath}`,
          data: linkPayload,
        },
      });

      if (otpError) {
        await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
        return { error: otpError.message };
      }
    }

    return { error: null };
  }

  // Main path: use generateLink to get hashed_token, then build custom app-domain URLs.
  // This keeps all invite links on our domain instead of the Supabase-hosted URL.
  const { data: inviteLinkData, error: inviteLinkError } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: linkPayload },
    });

  let actionLink: string | null = null;
  let existingUser = false;

  if (!inviteLinkError && inviteLinkData?.properties?.hashed_token) {
    // New user: verify token → create password → accept invite
    const ht = inviteLinkData.properties.hashed_token;
    actionLink = `${siteUrl}/auth/confirm?token_hash=${ht}&type=invite&next=${encodeURIComponent(setPasswordPath)}`;
  } else if (inviteLinkError) {
    const isExistingUserError = inviteLinkError.message
      .toLowerCase()
      .includes("already been registered");

    if (!isExistingUserError) {
      await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
      return { error: inviteLinkError.message };
    }

    const { data: magicLinkData, error: magicLinkError } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { data: linkPayload },
      });

    if (magicLinkError || !magicLinkData?.properties?.hashed_token) {
      await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
      return { error: magicLinkError?.message ?? "Не удалось сгенерировать ссылку приглашения" };
    }

    existingUser = true;
    // Existing user: verify token → accept invite (no password creation needed)
    const ht = magicLinkData.properties.hashed_token;
    actionLink = `${siteUrl}/auth/confirm?token_hash=${ht}&type=magiclink&next=${encodeURIComponent(inviteAcceptPath)}`;
  }

  if (!actionLink) {
    await supabase.from("invitations").delete().eq("id", insertedInvitation.id);
    return { error: "Не удалось сгенерировать ссылку приглашения" };
  }

  try {
    await sendInvitationEmail({
      to: email,
      actionLink,
      venueName: venueRow.name,
      accountName,
      inviterName,
      roleName,
      existingUser,
    });
  } catch (emailError) {
    await supabase
      .from("invitations")
      .delete()
      .eq("id", insertedInvitation.id);
    return {
      error:
        emailError instanceof Error
          ? emailError.message
          : "Не удалось отправить письмо-приглашение",
    };
  }

  return { error: null };
}

// Сохранение профиля пользователя (шаг 1 онбординга — владелец и сотрудник)
export async function saveProfile(data: {
  firstName:  string;
  lastName:   string;
  gender:     string;
  birthDate:  string;
  phone:      string;
  telegramId: string;
  address:    string;
  photoUrl:   string | null;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name:  data.firstName.trim(),
      last_name:   data.lastName.trim(),
      gender:      data.gender,
      birth_date:  data.birthDate,
      phone:       data.phone.trim(),
      telegram_id: data.telegramId.trim(),
      address:     data.address.trim() || null,
      avatar_url:  data.photoUrl,
      photo_url:   data.photoUrl,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { error: null };
}

// Получение системных ролей (для выбора в онбординге).
// После Stage D venue-scoped refactor единственная системная роль — owner.
// Функция оставлена для совместимости с UI: фактически возвращает пустой
// список (мы исключаем owner), и wizard это корректно обрабатывает.
export async function getSystemRoles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, code")
    .is("venue_id", null)
    .neq("code", "owner")
    .order("name");

  if (error) return [];
  return data ?? [];
}

type QuickRestoProvider = "quickresto";

const QUICK_RESTO_BOT_ROLE_TITLE = "Sheerly";
const QUICK_RESTO_BOT_EMPLOYEE_NAME = "Sheerly Bot";
const QUICK_RESTO_REQUIRED_BACKOFFICE_RIGHTS = [
  { code: "warehouse.documents.incoming", label: "Приходные накладные" },
  { code: "warehouse.documents.outgoing", label: "Расходные накладные" },
  { code: "warehouse.documents.exchange", label: "Внутренние перемещения" },
  { code: "warehouse.documents.discard", label: "Акты списания" },
  { code: "warehouse.documents.cooking", label: "Акты приготовления" },
  { code: "warehouse.documents.decomposition", label: "Акты разбора" },
  { code: "warehouse.documents.processing", label: "Акты переработки" },
  { code: "warehouse.inventory.document", label: "Акты инвентаризации" },
] as const;

type ImportSummary = {
  venuesCreated: number;
  venuesUpdated: number;
  rolesCreated: number;
  rolesUpdated: number;
  inventoryStoresSynced: number;
  inventoryGroupsSynced: number;
  inventoryProductsSynced: number;
  employeeInvitationsSent: number;
  employeesAutoCreated: number;
  employeesAutoUpdated: number;
  skippedBlockedEmployees: number;
  skippedNoEmailEmployees: number;
  skippedMissingRoleEmployees: number;
  skippedNoVenueEmployees: number;
  errors: string[];
};

function isValidEmail(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function toVenueName(venue: QuickRestoTableScheme): string {
  return (
    (typeof venue.name === "string" ? venue.name : null) ??
    (typeof venue.itemTitle === "string" ? venue.itemTitle : null) ??
    `Quick Resto venue #${venue.id}`
  );
}

function toVenueAddress(venue: QuickRestoTableScheme): string {
  return (
    (typeof venue.address?.fullAddress === "string" ? venue.address.fullAddress : null) ??
    ""
  );
}

function buildImportedEmail(accountId: string, externalEmployeeId: number): string {
  const compactAccountId = accountId.replace(/-/g, "").slice(0, 12);
  return `quickresto+${compactAccountId}.${externalEmployeeId}@import.local`;
}

function splitEmployeeName(employee: QuickRestoEmployeeRead): {
  firstName: string | null;
  lastName: string | null;
  telegramId: string | null;
  phone: string | null;
  birthDate: string | null;
} {
  return {
    firstName: employee.firstName?.trim() || null,
    lastName: employee.lastName?.trim() || null,
    telegramId:
      typeof employee.user?.telegramId === "string" && employee.user.telegramId.trim()
        ? employee.user.telegramId.trim()
        : null,
    phone:
      typeof employee.phoneNumber === "string" && employee.phoneNumber.trim()
        ? employee.phoneNumber.trim()
        : null,
    birthDate:
      typeof employee.dateOfBirth === "string" && employee.dateOfBirth.trim()
        ? employee.dateOfBirth.trim()
        : null,
  };
}

async function findAuthUserByEmail(email: string, adminClient: ReturnType<typeof createAdminClient>) {
  const listed = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) return null;
  return listed.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function getOwnerRoleId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from("roles")
    .select("id")
    .is("venue_id", null)
    .eq("code", "owner")
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertExternalLink(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
  entityType: "venue" | "role" | "staff" | "ingredient" | "ingredient_group" | "store";
  externalId: string;
  localTable: string;
  localId: string;
}) {
  const db = asLooseClient(params.client);
  await db
    .from("external_entity_links")
    .upsert(
      {
        account_id: params.accountId,
        provider: params.provider,
        entity_type: params.entityType,
        external_id: params.externalId,
        local_table: params.localTable,
        local_id: params.localId,
      },
      { onConflict: "account_id,provider,entity_type,external_id" }
    );
}

async function saveSnapshot(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
  entityType: string;
  externalId: string;
  payload: unknown;
}) {
  const db = asLooseClient(params.client);
  await db
    .from("integration_external_snapshots")
    .upsert(
      {
        account_id: params.accountId,
        provider: params.provider,
        entity_type: params.entityType,
        external_id: params.externalId,
        payload: params.payload,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "account_id,provider,entity_type,external_id" }
    );
}

async function syncQuickRestoInventoryCatalog(params: {
  adminClient: ReturnType<typeof createAdminClient>;
  adminDb: LooseSupabaseClient;
  accountId: string;
  userId: string;
  login: string;
  password: string;
  importStores: boolean;
  importIngredientGroups: boolean;
  importIngredients: boolean;
  summary: ImportSummary;
}) {
  const auth = { layerName: params.login, login: params.login, password: params.password };
  const syncedAt = new Date().toISOString();
  // Тот же резолвер, что и у боевой синхронизации: приоритет у venue,
  // импортированного из QR, а активное venue пользователя — лишь запасной
  // вариант. Своя двухшаговая версия тут пропускала первый шаг.
  const { data: profileRow } = await params.adminClient
    .from("profiles")
    .select("active_venue_id")
    .eq("id", params.userId)
    .maybeSingle();
  const defaultVenueId = await resolveDefaultVenueId({
    admin: asLooseDb(params.adminClient),
    accountId: params.accountId,
    activeVenueId:
      (profileRow as { active_venue_id?: string | null } | null)?.active_venue_id ?? null,
  });

  const storeItemsPromise =
    params.importIngredientGroups || params.importIngredients ? listIngredientTreeItems(auth) : Promise.resolve([]);
  const storesPromise = params.importStores ? listStores(auth) : Promise.resolve([]);
  const [storeItems, stores] = await Promise.all([storeItemsPromise, storesPromise]);
  const inventoryItems = storeItems as Array<QuickRestoSingleCategory | QuickRestoSingleProduct>;
  const groups = inventoryItems.filter((item): item is QuickRestoSingleCategory =>
    isQuickRestoClass(item, "SingleCategory")
  );
  const products = inventoryItems.filter((item): item is QuickRestoSingleProduct =>
    isQuickRestoClass(item, "SingleProduct")
  );
  const groupExternalIds = groups
    .map((group) => (typeof group.id === "number" ? String(group.id) : null))
    .filter((id): id is string => Boolean(id));
  const productExternalIds = products
    .map((product) => (typeof product.id === "number" ? String(product.id) : null))
    .filter((id): id is string => Boolean(id));

  if (params.importIngredients && groupExternalIds.length > 0) {
    await params.adminDb
      .from("ingredients")
      .delete()
      .eq("account_id", params.accountId)
      .in("external_id", groupExternalIds);
  }
  if (params.importIngredientGroups && productExternalIds.length > 0) {
    await params.adminDb
      .from("ingredient_groups")
      .delete()
      .eq("account_id", params.accountId)
      .in("external_id", productExternalIds);
  }

  if (params.importIngredientGroups) {
    const groupByExternalId = new Map<string, string>();

    for (const group of groups) {
      if (typeof group.id !== "number") continue;
      const parentExternalId =
        typeof group.parentId === "number"
          ? String(group.parentId)
          : typeof group.parentItem?.id === "number"
            ? String(group.parentItem.id)
            : null;

      const { data: row, error } = await params.adminDb
        .from("ingredient_groups")
        .upsert(
          {
            account_id: params.accountId,
            external_id: String(group.id),
            name: groupName(group),
            item_title: text(group.itemTitle),
            parent_group_id: null,
            parent_external_id: parentExternalId,
            raw_payload: group,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();

      const saved = row as { id?: string } | null;
      if (error || !saved?.id) {
        params.summary.errors.push(`Ingredient group ${group.id}: ${error?.message ?? "save error"}`);
        continue;
      }

      groupByExternalId.set(String(group.id), saved.id);
      params.summary.inventoryGroupsSynced += 1;
      await upsertExternalLink({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "ingredient_group",
        externalId: String(group.id),
        localTable: "ingredient_groups",
        localId: saved.id,
      });
      await saveSnapshot({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "ingredient_group",
        externalId: String(group.id),
        payload: group,
      });
    }

    for (const group of groups) {
      const localId = groupByExternalId.get(String(group.id));
      const parentExternalId =
        typeof group.parentId === "number"
          ? String(group.parentId)
          : typeof group.parentItem?.id === "number"
            ? String(group.parentItem.id)
            : null;
      const parentId = parentExternalId ? groupByExternalId.get(parentExternalId) : null;
      if (localId && parentId) {
        await params.adminDb.from("ingredient_groups").update({ parent_group_id: parentId }).eq("id", localId);
      }
    }
  }

  if (params.importIngredients) {
    const groupsResult = await params.adminDb
      .from("ingredient_groups")
      .select("id, external_id")
      .eq("account_id", params.accountId);
    const groupByExternalId = new Map(
      (((groupsResult.data as Array<{ id: string; external_id: string }> | null) ?? []).map((row) => [
        row.external_id,
        row.id,
      ]))
    );
    for (const product of products) {
      if (typeof product.id !== "number") continue;
      const parentExternalId =
        typeof product.parentId === "number"
          ? String(product.parentId)
          : typeof product.parentItem?.id === "number"
            ? String(product.parentItem.id)
            : null;

      const { data: row, error } = await params.adminDb
        .from("ingredients")
        .upsert(
          {
            account_id: params.accountId,
            external_id: String(product.id),
            kind: "ingredient",
            external_version: typeof product.version === "number" ? product.version : null,
            name: productName(product, `Ингредиент #${product.id}`),
            item_title: text(product.itemTitle),
            article: text(product.article),
            barcode: text(product.barCode),
            measure_unit_id: typeof product.measureUnit?.id === "number" ? product.measureUnit.id : null,
            measure_unit_name: text(product.measureUnit?.name),
            measure_unit_full_name: text(product.measureUnit?.fullName),
            measure_unit_code: text(product.measureUnit?.code),
            ratio: num(product.ratio),
            group_id: parentExternalId ? groupByExternalId.get(parentExternalId) ?? null : null,
            parent_external_id: parentExternalId,
            tags: Array.isArray(product.storeItemTags) ? product.storeItemTags : [],
            current_prime_cost: num(product.currentPrimeCost),
            store_quantity_kg: num(product.storeQuantityKg),
            stock_limit: num(product.limit),
            raw_payload: product,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();

      const saved = row as { id?: string } | null;
      if (error || !saved?.id) {
        params.summary.errors.push(`Ingredient ${product.id}: ${error?.message ?? "save error"}`);
        continue;
      }

      params.summary.inventoryProductsSynced += 1;
      await upsertExternalLink({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "ingredient",
        externalId: String(product.id),
        localTable: "ingredients",
        localId: saved.id,
      });
      await saveSnapshot({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "ingredient",
        externalId: String(product.id),
        payload: product,
      });
    }
  }

  if (params.importStores) {
    for (const store of stores) {
      if (typeof store.id !== "number") continue;

      // Нужен только факт существования склада — от него зависит, трогаем ли
      // привязку. Ошибку чтения разбираем: { data: null, error } без
      // исключения сделал бы существующий склад «новым», и синхронизация
      // переписала бы ручную привязку.
      const { data: existing, error: existingError } = await params.adminDb
        .from("stores")
        .select("id")
        .eq("account_id", params.accountId)
        .eq("external_id", String(store.id))
        .maybeSingle();
      if (existingError) {
        params.summary.errors.push(`Store ${store.id}: ${existingError.message}`);
        continue;
      }
      const existingStore = existing as { id?: string } | null;

      const { data: row, error } = await params.adminDb
        .from("stores")
        .upsert(
          {
            account_id: params.accountId,
            external_id: String(store.id),
            title: storeTitle(store),
            store_code: text(store.storeCode),
            description: text(store.description),
            // См. боевую синхронизацию: колонку трогаем только у нового склада.
            ...storeVenueBindingPatch({
              storeExists: Boolean(existingStore?.id),
              defaultVenueId,
            }),
            raw_payload: store,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();

      const saved = row as { id?: string } | null;
      if (error || !saved?.id) {
        params.summary.errors.push(`Store ${store.id}: ${error?.message ?? "save error"}`);
        continue;
      }

      params.summary.inventoryStoresSynced += 1;
      await upsertExternalLink({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "store",
        externalId: String(store.id),
        localTable: "stores",
        localId: saved.id,
      });
      await saveSnapshot({
        client: params.adminDb,
        accountId: params.accountId,
        provider: "quickresto",
        entityType: "store",
        externalId: String(store.id),
        payload: store,
      });
    }
  }
}

async function findExternalLinkLocalId(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
  entityType: "venue" | "role" | "staff" | "ingredient" | "ingredient_group" | "store";
  externalId: number | string;
}): Promise<string | null> {
  const db = asLooseClient(params.client);
  const { data } = await db
    .from("external_entity_links")
    .select("local_id")
    .eq("account_id", params.accountId)
    .eq("provider", params.provider)
    .eq("entity_type", params.entityType)
    .eq("external_id", String(params.externalId))
    .maybeSingle();

  const row = data as { local_id?: string } | null;
  return row?.local_id ?? null;
}

const QUICK_RESTO_CONNECTION_COLUMNS = [
  "id",
  "account_id",
  "provider",
  "login",
  "password_encrypted",
  "password_iv",
  "password_tag",
  "backoffice_base_url",
  "backoffice_login",
  "backoffice_password_encrypted",
  "backoffice_password_iv",
  "backoffice_password_tag",
  "backoffice_cookie_encrypted",
  "backoffice_cookie_iv",
  "backoffice_cookie_tag",
  "backoffice_cookie_fetched_at",
  "backoffice_last_tested_at",
  "quickresto_bot_role_external_id",
  "quickresto_bot_employee_external_id",
].join(", ");

type QuickRestoConnection = {
  id: string;
  account_id: string;
  provider: QuickRestoProvider;
  login: string;
  password_encrypted: string;
  password_iv: string;
  password_tag: string;
  backoffice_base_url?: string | null;
  backoffice_login?: string | null;
  backoffice_password_encrypted?: string | null;
  backoffice_password_iv?: string | null;
  backoffice_password_tag?: string | null;
  backoffice_cookie_encrypted?: string | null;
  backoffice_cookie_iv?: string | null;
  backoffice_cookie_tag?: string | null;
  backoffice_cookie_fetched_at?: string | null;
  backoffice_last_tested_at?: string | null;
  quickresto_bot_role_external_id?: string | null;
  quickresto_bot_employee_external_id?: string | null;
};

async function getConnectionById(params: {
  client: unknown;
  connectionId: string;
}) {
  const db = asLooseClient(params.client);
  const { data, error } = await db
    .from("integration_connections")
    .select(QUICK_RESTO_CONNECTION_COLUMNS)
    .eq("id", params.connectionId)
    .maybeSingle();

  if (error || !data) return null;
  return data as QuickRestoConnection;
}

async function getConnectionByAccount(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
}) {
  const db = asLooseClient(params.client);
  const { data, error } = await db
    .from("integration_connections")
    .select(QUICK_RESTO_CONNECTION_COLUMNS)
    .eq("account_id", params.accountId)
    .eq("provider", params.provider)
    .maybeSingle();

  if (error || !data) return null;
  return data as QuickRestoConnection;
}

function decryptConnectionPassword(connection: {
  password_encrypted: string;
  password_iv: string;
  password_tag: string;
}) {
  return decryptSecret({
    encrypted: connection.password_encrypted,
    iv: connection.password_iv,
    tag: connection.password_tag,
  });
}

function encryptionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.includes("INTEGRATIONS_ENCRYPTION_KEY")
    ? "Не настроен ключ шифрования интеграций. Проверьте INTEGRATIONS_ENCRYPTION_KEY."
    : message;
}

async function resolveQuickRestoConnection(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string | null;
  accountId?: string;
  connectionId?: string | null;
}) {
  let connection = params.connectionId
    ? await getConnectionById({ client: params.supabase, connectionId: params.connectionId })
    : params.accountId
      ? await getConnectionByAccount({
          client: params.supabase,
          accountId: params.accountId,
          provider: "quickresto",
        })
      : null;

  if (!connection && params.accountId && params.userId) {
    const { data: accountRow } = await params.supabase
      .from("accounts")
      .select("id, owner_id")
      .eq("id", params.accountId)
      .maybeSingle();

    if (accountRow?.owner_id === params.userId) {
      const adminDb = asLooseClient(createAdminClient() as unknown as { from: (table: string) => LooseQueryBuilder });
      connection = await getConnectionByAccount({
        client: adminDb,
        accountId: params.accountId,
        provider: "quickresto",
      });
    }
  }

  return connection;
}

function normalizeQuickRestoTitle(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function quickRestoRoleRightShortNames(role: QuickRestoRole) {
  const names = new Set<string>();
  for (const rawLink of role.rightLinks ?? []) {
    const link = asObject(rawLink);
    const direct = text(link.shortName);
    const nested = text(asObject(link.right).shortName);
    if (direct) names.add(direct);
    if (nested) names.add(nested);
  }
  return names;
}

function quickRestoRoleMissingRights(role: QuickRestoRole) {
  const rights = quickRestoRoleRightShortNames(role);
  return QUICK_RESTO_REQUIRED_BACKOFFICE_RIGHTS
    .filter((required) => !rights.has(required.code))
    .map((required) => ({ code: required.code, label: required.label }));
}

async function readQuickRestoBotRole(params: {
  connection: QuickRestoConnection;
  password: string;
}) {
  const roles = await listRoles({
    layerName: params.connection.login,
    login: params.connection.login,
    password: params.password,
  });
  const roleListItem = roles.find((role) =>
    normalizeQuickRestoTitle(role.title) === normalizeQuickRestoTitle(QUICK_RESTO_BOT_ROLE_TITLE)
  );
  if (!roleListItem) return null;

  return readRole({
    layerName: params.connection.login,
    login: params.connection.login,
    password: params.password,
    objectId: roleListItem.id,
  });
}

export async function createAccountOnly(data: {
  accountName: string;
  accountLogoUrl: string | null;
}): Promise<{ accountId: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { accountId: null, error: "Не авторизован" };

  const { data: row, error } = await supabase
    .from("accounts")
    .insert({
      name: data.accountName.trim(),
      logo_url: data.accountLogoUrl,
      owner_id: user.id,
    })
    .select("id")
    .single();

  if (error) return { accountId: null, error: error.message };
  return { accountId: row.id, error: null };
}

export async function saveQuickRestoCredentials(data: {
  accountId: string;
  login: string;
  password: string;
}): Promise<{ connectionId: string | null; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { connectionId: null, error: "Не авторизован" };

  let encrypted: ReturnType<typeof encryptSecret>;
  try {
    encrypted = encryptSecret(data.password);
  } catch (error) {
    return {
      connectionId: null,
      error: encryptionErrorMessage(error, "Ошибка шифрования пароля Quick Resto"),
    };
  }

  const db = asLooseClient(supabase);
  const { data: row, error } = await db
    .from("integration_connections")
    .upsert(
      {
        account_id: data.accountId,
        provider: "quickresto",
        login: data.login.trim(),
        password_encrypted: encrypted.encrypted,
        password_iv: encrypted.iv,
        password_tag: encrypted.tag,
        backoffice_base_url: null,
        backoffice_login: null,
        backoffice_password_encrypted: null,
        backoffice_password_iv: null,
        backoffice_password_tag: null,
        backoffice_cookie_encrypted: null,
        backoffice_cookie_iv: null,
        backoffice_cookie_tag: null,
        backoffice_cookie_fetched_at: null,
        backoffice_last_tested_at: null,
        quickresto_bot_role_external_id: null,
        quickresto_bot_employee_external_id: null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,provider" }
    )
    .select("id")
    .single();

  const savedConnection = row as { id?: string } | null;
  if (error || !savedConnection?.id) {
    return { connectionId: null, error: error?.message ?? "Не удалось сохранить подключение" };
  }

  return { connectionId: savedConnection.id, error: null };
}

export async function testQuickRestoConnection(data: {
  connectionId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = await createClient();
  const connection = await getConnectionById({ client: supabase, connectionId: data.connectionId });
  if (!connection) return { ok: false, error: "Подключение не найдено" };

  try {
    const password = decryptConnectionPassword(connection);
    await listTableSchemes({
      layerName: connection.login,
      login: connection.login,
      password,
    });

    const db = asLooseClient(supabase);
    await db
      .from("integration_connections")
      .update({ last_tested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", connection.id);

    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка проверки подключения";
    if (message.includes("401")) {
      return { ok: false, error: "Неверный логин или пароль Quick Resto" };
    }
    return { ok: false, error: message };
  }
}

export async function verifyQuickRestoBotRole(data: {
  accountId?: string | null;
  connectionId?: string | null;
}): Promise<{
  ok: boolean;
  roleId: number | null;
  roleTitle: string | null;
  missingRights: Array<{ code: string; label: string }>;
  backOfficeUser: boolean;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      roleId: null,
      roleTitle: null,
      missingRights: [],
      backOfficeUser: false,
      error: "Не авторизован",
    };
  }

  const connection = await resolveQuickRestoConnection({
    supabase,
    userId: user.id,
    accountId: data.accountId ?? undefined,
    connectionId: data.connectionId,
  });
  if (!connection) {
    return {
      ok: false,
      roleId: null,
      roleTitle: null,
      missingRights: [],
      backOfficeUser: false,
      error: "Подключение Quick Resto не найдено",
    };
  }

  try {
    const password = decryptConnectionPassword(connection);
    const role = await readQuickRestoBotRole({ connection, password });
    if (!role) {
      return {
        ok: false,
        roleId: null,
        roleTitle: null,
        missingRights: [],
        backOfficeUser: false,
        error: `В Quick Resto не найдена должность «${QUICK_RESTO_BOT_ROLE_TITLE}»`,
      };
    }

    const backOfficeUser = role.backOfficeUser === true;
    const missingRights = quickRestoRoleMissingRights(role);
    const ok = backOfficeUser && missingRights.length === 0;

    if (ok) {
      await asLooseClient(supabase)
        .from("integration_connections")
        .update({
          quickresto_bot_role_external_id: String(role.id),
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);
    }

    return {
      ok,
      roleId: role.id,
      roleTitle: role.title ?? QUICK_RESTO_BOT_ROLE_TITLE,
      missingRights,
      backOfficeUser,
      error: ok
        ? null
        : "Должность найдена, но у нее нет всех нужных прав для работы с актами Quick Resto",
    };
  } catch (error) {
    return {
      ok: false,
      roleId: null,
      roleTitle: null,
      missingRights: [],
      backOfficeUser: false,
      error: error instanceof Error ? error.message : "Не удалось проверить должность Quick Resto",
    };
  }
}

export async function verifyQuickRestoBotEmployee(data: {
  accountId?: string | null;
  connectionId?: string | null;
  roleExternalId?: number | null;
}): Promise<{
  ok: boolean;
  employeeId: number | null;
  employeeName: string | null;
  roleTitle: string | null;
  login: string | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, employeeId: null, employeeName: null, roleTitle: null, login: null, error: "Не авторизован" };
  }

  const connection = await resolveQuickRestoConnection({
    supabase,
    userId: user.id,
    accountId: data.accountId ?? undefined,
    connectionId: data.connectionId,
  });
  if (!connection) {
    return {
      ok: false,
      employeeId: null,
      employeeName: null,
      roleTitle: null,
      login: null,
      error: "Подключение Quick Resto не найдено",
    };
  }

  try {
    const password = decryptConnectionPassword(connection);
    const roleExternalId =
      data.roleExternalId ??
      (connection.quickresto_bot_role_external_id
        ? Number(connection.quickresto_bot_role_external_id)
        : null);
    const employees = await listEmployees({
      layerName: connection.login,
      login: connection.login,
      password,
    });
    const candidates = employees.filter((employee) => {
      const fullName = employee.fullName ?? [employee.firstName, employee.lastName].filter(Boolean).join(" ");
      return normalizeQuickRestoTitle(fullName).includes(normalizeQuickRestoTitle(QUICK_RESTO_BOT_EMPLOYEE_NAME));
    });

    if (candidates.length === 0) {
      return {
        ok: false,
        employeeId: null,
        employeeName: null,
        roleTitle: null,
        login: null,
        error: `В Quick Resto не найден сотрудник «${QUICK_RESTO_BOT_EMPLOYEE_NAME}»`,
      };
    }

    const reads = await Promise.allSettled(
      candidates.map((employee) =>
        readEmployee({
          layerName: connection.login,
          login: connection.login,
          password,
          objectId: employee.id,
        })
      )
    );
    const readableEmployees = reads
      .filter((result): result is PromiseFulfilledResult<QuickRestoEmployeeRead> => result.status === "fulfilled")
      .map((result) => result.value);
    const matchedEmployee = readableEmployees.find((employee) => {
      if (employee.blocked) return false;
      if (!employee.user?.id) return false;
      const employeeRoleId = employee.user.role?.id ?? null;
      if (typeof roleExternalId === "number" && Number.isFinite(roleExternalId)) {
        return employeeRoleId === roleExternalId;
      }
      return normalizeQuickRestoTitle(employee.user.role?.title) === normalizeQuickRestoTitle(QUICK_RESTO_BOT_ROLE_TITLE);
    });

    if (!matchedEmployee) {
      return {
        ok: false,
        employeeId: null,
        employeeName: null,
        roleTitle: null,
        login: null,
        error: `Сотрудник «${QUICK_RESTO_BOT_EMPLOYEE_NAME}» найден, но он заблокирован, без пользователя бэк-офиса или без должности «${QUICK_RESTO_BOT_ROLE_TITLE}»`,
      };
    }

    await asLooseClient(supabase)
      .from("integration_connections")
      .update({
        quickresto_bot_employee_external_id: String(matchedEmployee.id),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return {
      ok: true,
      employeeId: matchedEmployee.id,
      employeeName:
        matchedEmployee.fullName ??
        [matchedEmployee.firstName, matchedEmployee.lastName].filter(Boolean).join(" ") ??
        QUICK_RESTO_BOT_EMPLOYEE_NAME,
      roleTitle: matchedEmployee.user?.role?.title ?? QUICK_RESTO_BOT_ROLE_TITLE,
      login: matchedEmployee.user?.login ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      employeeId: null,
      employeeName: null,
      roleTitle: null,
      login: null,
      error: error instanceof Error ? error.message : "Не удалось проверить сотрудника Quick Resto",
    };
  }
}

export async function saveQuickRestoBackOfficeCredentials(data: {
  accountId?: string | null;
  connectionId?: string | null;
  login: string;
  password: string;
}): Promise<{ ok: boolean; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Не авторизован" };

  const connection = await resolveQuickRestoConnection({
    supabase,
    userId: user.id,
    accountId: data.accountId ?? undefined,
    connectionId: data.connectionId,
  });
  if (!connection) return { ok: false, error: "Подключение Quick Resto не найдено" };

  try {
    const session = await loginQuickRestoBackOffice({
      layerName: connection.login,
      login: data.login.trim(),
      password: data.password,
    });
    const encryptedPassword = encryptSecret(data.password);
    const encryptedCookie = encryptSecret(session.cookieHeader);
    const now = new Date().toISOString();

    const { error } = await asLooseClient(supabase)
      .from("integration_connections")
      .update({
        backoffice_base_url: null,
        backoffice_login: data.login.trim(),
        backoffice_password_encrypted: encryptedPassword.encrypted,
        backoffice_password_iv: encryptedPassword.iv,
        backoffice_password_tag: encryptedPassword.tag,
        backoffice_cookie_encrypted: encryptedCookie.encrypted,
        backoffice_cookie_iv: encryptedCookie.iv,
        backoffice_cookie_tag: encryptedCookie.tag,
        backoffice_cookie_fetched_at: now,
        backoffice_last_tested_at: now,
        updated_at: now,
      })
      .eq("id", connection.id);

    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: encryptionErrorMessage(error, "Не удалось проверить back-office доступ Quick Resto"),
    };
  }
}

export async function loadQuickRestoOptions(data: { accountId?: string; connectionId?: string | null }): Promise<{
  venues: Array<{ id: number; name: string; address: string }>;
  roles: Array<{ id: number; title: string; systemRole: string | null }>;
  employees: Array<{ id: number; fullName: string; blocked: boolean }>;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let connection = data.connectionId
    ? await getConnectionById({ client: supabase, connectionId: data.connectionId })
    : data.accountId
      ? await getConnectionByAccount({
          client: supabase,
          accountId: data.accountId,
          provider: "quickresto",
        })
      : null;

  // Fallback: if user-scoped read failed but owner/account is valid, fetch with admin client.
  if (!connection && data.accountId && user) {
    const { data: accountRow } = await supabase
      .from("accounts")
      .select("id, owner_id")
      .eq("id", data.accountId)
      .maybeSingle();

    if (accountRow?.owner_id === user.id) {
      const adminDb = asLooseClient(createAdminClient() as unknown as { from: (table: string) => LooseQueryBuilder });
      connection = await getConnectionByAccount({
        client: adminDb,
        accountId: data.accountId,
        provider: "quickresto",
      });
    }
  }

  if (!connection) {
    return { venues: [], roles: [], employees: [], error: "Сначала сохраните креды Quick Resto" };
  }

  const formatError = (value: unknown) => {
    const raw = value instanceof Error ? value.message : String(value ?? "unknown error");
    return raw.replace(/^Quick Resto request failed:\s*/i, "").slice(0, 180);
  };

  try {
    const password = decryptConnectionPassword(connection);
    const [venuesResult, rolesResult, employeesResult] = await Promise.allSettled([
      listTableSchemes({
        layerName: connection.login,
        login: connection.login,
        password,
      }),
      listRoles({
        layerName: connection.login,
        login: connection.login,
        password,
      }),
      listEmployees({
        layerName: connection.login,
        login: connection.login,
        password,
      }),
    ]);

    const venues =
      venuesResult.status === "fulfilled"
        ? venuesResult.value.map((v) => ({
            id: v.id,
            name: toVenueName(v),
            address: toVenueAddress(v),
          }))
        : [];

    const roles =
      rolesResult.status === "fulfilled"
        ? rolesResult.value.map((r) => ({
            id: r.id,
            title: r.title ?? `Role #${r.id}`,
            systemRole: typeof r.systemRole === "string" ? r.systemRole : null,
          }))
        : [];

    const employees =
      employeesResult.status === "fulfilled"
        ? employeesResult.value.map((e) => ({
            id: e.id,
            fullName: e.fullName ?? ([e.lastName, e.firstName].filter(Boolean).join(" ") || `Employee #${e.id}`),
            blocked: Boolean(e.blocked),
          }))
        : [];

    const loadErrors: string[] = [];
    if (venuesResult.status === "rejected") loadErrors.push(`заведения: ${formatError(venuesResult.reason)}`);
    if (rolesResult.status === "rejected") loadErrors.push(`должности: ${formatError(rolesResult.reason)}`);
    if (employeesResult.status === "rejected") loadErrors.push(`сотрудники: ${formatError(employeesResult.reason)}`);

    return {
      venues,
      roles,
      employees,
      error: loadErrors.length > 0 ? `Часть данных не загружена (${loadErrors.join("; ")})` : null,
    };
  } catch (error) {
    return {
      venues: [],
      roles: [],
      employees: [],
      error: error instanceof Error ? error.message : "Не удалось загрузить данные из Quick Resto",
    };
  }
}

export async function runQuickRestoImport(data: {
  accountId: string;
  connectionId?: string | null;
  selectedVenueExternalIds: number[];
  selectedRoleExternalIds: number[];
  selectedEmployeeExternalIds: number[];
  importVenues: boolean;
  importRoles: boolean;
  importEmployees: boolean;
  importStores?: boolean;
  importIngredientGroups?: boolean;
  importIngredients?: boolean;
}): Promise<{ runId: string | null; summary: ImportSummary | null; status: "success" | "partial" | "failed"; error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { runId: null, summary: null, status: "failed", error: "Не авторизован" };
  }

  const summary: ImportSummary = {
    venuesCreated: 0,
    venuesUpdated: 0,
    rolesCreated: 0,
    rolesUpdated: 0,
    inventoryStoresSynced: 0,
    inventoryGroupsSynced: 0,
    inventoryProductsSynced: 0,
    employeeInvitationsSent: 0,
    employeesAutoCreated: 0,
    employeesAutoUpdated: 0,
    skippedBlockedEmployees: 0,
    skippedNoEmailEmployees: 0,
    skippedMissingRoleEmployees: 0,
    skippedNoVenueEmployees: 0,
    errors: [],
  };

  const selectedVenueIdSet = new Set((data.selectedVenueExternalIds ?? []).map((id) => String(id)));
  const selectedRoleIdSet = new Set((data.selectedRoleExternalIds ?? []).map((id) => String(id)));
  const selectedEmployeeIdSet = new Set((data.selectedEmployeeExternalIds ?? []).map((id) => String(id)));

  let connection = data.connectionId
    ? await getConnectionById({ client: supabase, connectionId: data.connectionId })
    : await getConnectionByAccount({
        client: supabase,
        accountId: data.accountId,
        provider: "quickresto",
      });

  if (!connection) {
    const { data: accountRow } = await supabase
      .from("accounts")
      .select("id, owner_id")
      .eq("id", data.accountId)
      .maybeSingle();

    if (accountRow?.owner_id === user.id) {
      const adminDb = asLooseClient(createAdminClient() as unknown as { from: (table: string) => LooseQueryBuilder });
      connection = await getConnectionByAccount({
        client: adminDb,
        accountId: data.accountId,
        provider: "quickresto",
      });
    }
  }

  if (!connection) {
    return { runId: null, summary: null, status: "failed", error: "Подключение Quick Resto не найдено" };
  }

  const adminClient = createAdminClient();
  const db = asLooseClient(supabase);
  const adminDb = asLooseClient(adminClient as unknown as { from: (table: string) => LooseQueryBuilder });

  const { data: runRow, error: runInsertError } = await adminDb
    .from("integration_import_runs")
    .insert({
      account_id: data.accountId,
      provider: "quickresto",
      selected_entities: [
        ...(data.importVenues ? ["venues"] : []),
        ...(data.importRoles ? ["roles"] : []),
        ...(data.importEmployees ? ["employees"] : []),
        ...(data.importStores ? ["stores"] : []),
        ...(data.importIngredientGroups ? ["ingredient_groups"] : []),
        ...(data.importIngredients ? ["ingredients"] : []),
      ],
      selected_external_venue_ids: data.selectedVenueExternalIds.map(String),
      status: "running",
      created_by: user.id,
    })
    .select("id")
    .single();

  const importRun = runRow as { id?: string } | null;
  if (runInsertError || !importRun?.id) {
    return { runId: null, summary: null, status: "failed", error: runInsertError?.message ?? "Не удалось создать import run" };
  }

  const runId = importRun.id;

  try {
    const password = decryptConnectionPassword(connection);

    const ownerRoleId = await getOwnerRoleId(supabase);
    if (!ownerRoleId) throw new Error("Не найдена системная роль owner");

    const venueLocalByExternalId = new Map<number, string>();
    const roleLocalByExternalId = new Map<number, string>();

    if (data.importVenues && selectedVenueIdSet.size > 0) {
      const allSchemes = await listTableSchemes({
        layerName: connection.login,
        login: connection.login,
        password,
      });

      const selected = allSchemes.filter((v) => selectedVenueIdSet.has(String(v.id)));

      for (const venueListItem of selected) {
        const venue = await readTableScheme({
          layerName: connection.login,
          login: connection.login,
          password,
          objectId: venueListItem.id,
        });

        await saveSnapshot({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "venue",
          externalId: String(venue.id),
          payload: venue,
        });

        const { data: existingLink } = await db
          .from("external_entity_links")
          .select("local_id")
          .eq("account_id", data.accountId)
          .eq("provider", "quickresto")
          .eq("entity_type", "venue")
          .eq("external_id", String(venue.id))
          .maybeSingle();
        const existingVenueLink = existingLink as { local_id?: string } | null;

        let localVenueId: string;
        if (existingVenueLink?.local_id) {
          const { error: updateError } = await adminClient
            .from("venues")
            .update({
              name: toVenueName(venue),
              address: toVenueAddress(venue),
              comment: `Imported from Quick Resto (TableScheme:${venue.id})`,
            })
            .eq("id", existingVenueLink.local_id)
            .eq("account_id", data.accountId);

          if (updateError) {
            summary.errors.push(`Venue ${venue.id}: ${updateError.message}`);
            continue;
          }

          localVenueId = existingVenueLink.local_id;
          summary.venuesUpdated += 1;
        } else {
          const { data: insertedVenue, error: insertError } = await adminClient
            .from("venues")
            .insert({
              account_id: data.accountId,
              name: toVenueName(venue),
              address: toVenueAddress(venue),
              type: "restaurant",
              currency: "RUB",
              timezone: "Europe/Moscow",
              working_hours: {},
              comment: `Imported from Quick Resto (TableScheme:${venue.id})`,
            })
            .select("id")
            .single();

          if (insertError || !insertedVenue?.id) {
            summary.errors.push(`Venue ${venue.id}: ${insertError?.message ?? "insert error"}`);
            continue;
          }

          localVenueId = insertedVenue.id;
          summary.venuesCreated += 1;
        }

        venueLocalByExternalId.set(venue.id, localVenueId);

        await upsertExternalLink({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "venue",
          externalId: String(venue.id),
          localTable: "venues",
          localId: localVenueId,
        });

        const { error: ownerRoleError } = await adminClient
          .from("user_venue_roles")
          .upsert(
            {
              user_id: user.id,
              venue_id: localVenueId,
              role_id: ownerRoleId,
              status: "active",
            },
            { onConflict: "user_id,venue_id" }
          );

        if (ownerRoleError) {
          summary.errors.push(`Venue ${venue.id}: ${ownerRoleError.message}`);
        }
      }
    }

    // Каталог импортируем ПОСЛЕ заведений, а не до: склады привязываются к
    // заведению, и резолвер ищет его в том числе по ссылке в
    // external_entity_links, которую заводит цикл выше. В режиме QuickResto
    // визард создаёт аккаунт вообще без заведений (createAccountOnly), так что
    // при старом порядке резолвер не имел ни одного кандидата и все склады
    // приезжали в «Не распределённые».
    //
    // Плата за перестановку: если listTableSchemes не ответит, каталог тоже не
    // приедет. Это осознанно — импорт каталога длинный, и начинать его ради
    // складов, которым некуда привязаться, смысла нет. Прогон помечается
    // failed, повтор идемпотентен.
    if (data.importStores || data.importIngredientGroups || data.importIngredients) {
      await syncQuickRestoInventoryCatalog({
        adminClient,
        adminDb,
        accountId: data.accountId,
        userId: user.id,
        login: connection.login,
        password,
        importStores: Boolean(data.importStores),
        importIngredientGroups: Boolean(data.importIngredientGroups),
        importIngredients: Boolean(data.importIngredients),
        summary,
      });
    }

    if (data.importRoles && selectedRoleIdSet.size > 0) {
      const roles = await listRoles({
        layerName: connection.login,
        login: connection.login,
        password,
      });

      const selectedRoles = roles.filter((role) => selectedRoleIdSet.has(String(role.id)));

      // Stage D venue-scoped: импорт ролей привязывается к первому venue
      // этого аккаунта. QuickResto-импорт изначально создан под одно-venue
      // setup; для multi-venue логика выбора целевого venue нуждается в
      // отдельном UI-шаге, который пока не реализован.
      const { data: roleImportVenue } = await adminClient
        .from("venues")
        .select("id")
        .eq("account_id", data.accountId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const roleImportVenueId = (roleImportVenue as { id: string } | null)?.id;
      if (!roleImportVenueId) {
        summary.errors.push("Импорт ролей: в аккаунте нет ни одного заведения");
      }

      for (const role of selectedRoles) {
        if (!roleImportVenueId) break;

        await saveSnapshot({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "role",
          externalId: String(role.id),
          payload: role,
        });

        const { data: existingLink } = await db
          .from("external_entity_links")
          .select("local_id")
          .eq("account_id", data.accountId)
          .eq("provider", "quickresto")
          .eq("entity_type", "role")
          .eq("external_id", String(role.id))
          .maybeSingle();
        const existingRoleLink = existingLink as { local_id?: string } | null;

        const roleName = (role.title ?? `QuickResto Role ${role.id}`).trim();
        const roleCode = `qr_${role.id}`;

        let localRoleId: string;
        if (existingRoleLink?.local_id) {
          const { error: updateRoleError } = await adminClient
            .from("roles")
            .update({ name: roleName, comment: role.comment ?? null })
            .eq("id", existingRoleLink.local_id);

          if (updateRoleError) {
            summary.errors.push(`Role ${role.id}: ${updateRoleError.message}`);
            continue;
          }

          localRoleId = existingRoleLink.local_id;
          summary.rolesUpdated += 1;
        } else {
          const { data: insertedRole, error: insertRoleError } = await adminClient
            .from("roles")
            .insert({
              venue_id: roleImportVenueId,
              name: roleName,
              code: roleCode,
              comment: role.comment ?? null,
            })
            .select("id")
            .single();

          if (insertRoleError || !insertedRole?.id) {
            summary.errors.push(`Role ${role.id}: ${insertRoleError?.message ?? "insert error"}`);
            continue;
          }

          localRoleId = insertedRole.id;
          summary.rolesCreated += 1;
        }

        roleLocalByExternalId.set(role.id, localRoleId);

        await upsertExternalLink({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "role",
          externalId: String(role.id),
          localTable: "roles",
          localId: localRoleId,
        });
      }
    }

    if (data.importEmployees && selectedEmployeeIdSet.size > 0) {
      const { data: accountVenues } = await adminClient
        .from("venues")
        .select("id")
        .eq("account_id", data.accountId);
      const fallbackAccountVenueIds = ((accountVenues as { id: string }[] | null) ?? []).map((v) => v.id);

      const employees = await listEmployees({
        layerName: connection.login,
        login: connection.login,
        password,
      });
      const selectedEmployees = employees.filter((employee) => selectedEmployeeIdSet.has(String(employee.id)));

      for (const employee of selectedEmployees) {
        if (employee.blocked) {
          summary.skippedBlockedEmployees += 1;
          continue;
        }

        let employeeRead: QuickRestoEmployeeRead;
        try {
          employeeRead = await readEmployee({
            layerName: connection.login,
            login: connection.login,
            password,
            objectId: employee.id,
          });
        } catch (error) {
          summary.errors.push(
            `Employee ${employee.id}: ${error instanceof Error ? error.message : "read failed"}`
          );
          continue;
        }

        await saveSnapshot({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "employee",
          externalId: String(employee.id),
          payload: employeeRead,
        });

        const externalRoleId = employeeRead.user?.role?.id;
        let localRoleId: string | null | undefined =
          typeof externalRoleId === "number" ? roleLocalByExternalId.get(externalRoleId) : undefined;
        if (!localRoleId && typeof externalRoleId === "number") {
          localRoleId = await findExternalLinkLocalId({
            client: adminDb,
            accountId: data.accountId,
            provider: "quickresto",
            entityType: "role",
            externalId: externalRoleId,
          });
        }

        if (!localRoleId) {
          const fallbackRoleName =
            (typeof employeeRead.user?.role?.title === "string" ? employeeRead.user.role.title.trim() : "") ||
            `QuickResto Role ${typeof externalRoleId === "number" ? externalRoleId : employee.id}`;
          const fallbackRoleCode =
            typeof externalRoleId === "number"
              ? `qr_${externalRoleId}`
              : `qr_emp_${employee.id}`;

          // Stage D venue-scoped: fallback роль создаётся в первом venue
          // аккаунта (как и обычный импорт ролей выше). Если venue нет —
          // пропускаем создание роли.
          const fallbackVenueId = fallbackAccountVenueIds[0];
          if (!fallbackVenueId) {
            summary.errors.push(
              `Employee ${employee.id}: fallback role skipped (нет venue в аккаунте)`,
            );
            continue;
          }
          const { data: insertedFallbackRole, error: insertFallbackRoleError } = await adminClient
            .from("roles")
            .upsert(
              {
                venue_id: fallbackVenueId,
                name: fallbackRoleName,
                code: fallbackRoleCode,
                comment: "Создано автоматически на основе импорта сотрудников из Quick Resto",
              },
              { onConflict: "code,venue_id" }
            )
            .select("id")
            .single();

          if (insertFallbackRoleError || !insertedFallbackRole?.id) {
            summary.errors.push(
              `Employee ${employee.id}: fallback role create failed (${insertFallbackRoleError?.message ?? "unknown"})`
            );
          } else {
            localRoleId = insertedFallbackRole.id;
            if (typeof externalRoleId === "number") {
              roleLocalByExternalId.set(externalRoleId, localRoleId);
              await upsertExternalLink({
                client: adminDb,
                accountId: data.accountId,
                provider: "quickresto",
                entityType: "role",
                externalId: String(externalRoleId),
                localTable: "roles",
                localId: localRoleId,
              });
            }
          }
        }

        if (!localRoleId) {
          summary.skippedMissingRoleEmployees += 1;
          continue;
        }

        const allowedSchemes = Array.isArray(employeeRead.allowedTablesSchemes)
          ? employeeRead.allowedTablesSchemes
              .map((s) => (typeof s?.id === "number" ? s.id : null))
              .filter((id): id is number => id !== null)
          : [];

        const localVenueIds: string[] = [];
        if (allowedSchemes.length > 0) {
          for (const schemeId of allowedSchemes) {
            let localVenueId = venueLocalByExternalId.get(schemeId) ?? null;
            if (!localVenueId) {
              localVenueId = await findExternalLinkLocalId({
                client: adminDb,
                accountId: data.accountId,
                provider: "quickresto",
                entityType: "venue",
                externalId: schemeId,
              });
            }
            if (localVenueId && !localVenueIds.includes(localVenueId)) {
              localVenueIds.push(localVenueId);
            }
          }
        } else {
          for (const selectedVenueExternalId of selectedVenueIdSet) {
            const externalId = Number(selectedVenueExternalId);
            if (!Number.isFinite(externalId)) continue;
            let localVenueId = venueLocalByExternalId.get(externalId) ?? null;
            if (!localVenueId) {
              localVenueId = await findExternalLinkLocalId({
                client: adminDb,
                accountId: data.accountId,
                provider: "quickresto",
                entityType: "venue",
                externalId,
              });
            }
            if (localVenueId && !localVenueIds.includes(localVenueId)) {
              localVenueIds.push(localVenueId);
            }
          }
        }

        if (localVenueIds.length === 0) {
          for (const accountVenueId of fallbackAccountVenueIds) {
            if (!localVenueIds.includes(accountVenueId)) {
              localVenueIds.push(accountVenueId);
            }
          }
        }

        const login = typeof employeeRead.user?.login === "string" ? employeeRead.user.login.trim() : "";
        const targetEmail = isValidEmail(login) ? login.toLowerCase() : buildImportedEmail(data.accountId, employee.id);

        const { data: existingStaffLink } = await db
          .from("external_entity_links")
          .select("local_id")
          .eq("account_id", data.accountId)
          .eq("provider", "quickresto")
          .eq("entity_type", "staff")
          .eq("external_id", String(employee.id))
          .maybeSingle();
        const existingImportedStaff = existingStaffLink as { local_id?: string } | null;

        let localUserId = existingImportedStaff?.local_id ?? null;
        if (!localUserId) {
          const existingAuthUser = await findAuthUserByEmail(targetEmail, adminClient);
          if (existingAuthUser?.id) {
            localUserId = existingAuthUser.id;
            summary.employeesAutoUpdated += 1;
          } else {
            const created = await adminClient.auth.admin.createUser({
              email: targetEmail,
              password: randomUUID(),
              email_confirm: true,
              user_metadata: {
                imported_from_quickresto: true,
                quickresto_employee_id: employee.id,
                original_login: login || null,
              },
            });

            if (created.error && !created.error.message.toLowerCase().includes("already been registered")) {
              summary.errors.push(`Employee ${employee.id}: ${created.error.message}`);
              continue;
            }

            if (created.data?.user?.id) {
              localUserId = created.data.user.id;
              summary.employeesAutoCreated += 1;
            } else {
              const found = await findAuthUserByEmail(targetEmail, adminClient);
              if (!found?.id) {
                summary.errors.push(`Employee ${employee.id}: failed to resolve auth user`);
                continue;
              }
              localUserId = found.id;
              summary.employeesAutoUpdated += 1;
            }
          }
        } else {
          summary.employeesAutoUpdated += 1;
        }

        if (!localUserId) {
          summary.errors.push(`Employee ${employee.id}: local user id missing`);
          continue;
        }

        const name = splitEmployeeName(employeeRead);
        const pin =
          typeof employeeRead.user?.pin === "string" && employeeRead.user.pin.trim()
            ? employeeRead.user.pin.trim()
            : null;

        await adminDb
          .from("profiles")
          .update({
            first_name: name.firstName,
            last_name: name.lastName,
            phone: name.phone,
            telegram_id: name.telegramId,
            birth_date: name.birthDate,
          })
          .eq("id", localUserId);

        // PIN терминала — venue-specific, кладётся в UVR (не в profiles).
        for (const localVenueId of localVenueIds) {
          const { error: membershipError } = await adminClient
            .from("user_venue_roles")
            .upsert(
              {
                user_id: localUserId,
                venue_id: localVenueId,
                role_id: localRoleId,
                status: "active",
                invited_by: user.id,
                terminal_pin: pin,
              },
              { onConflict: "user_id,venue_id" }
            );
          if (membershipError) {
            summary.errors.push(`Employee ${employee.id} membership: ${membershipError.message}`);
          }
        }

        await upsertExternalLink({
          client: adminDb,
          accountId: data.accountId,
          provider: "quickresto",
          entityType: "staff",
          externalId: String(employee.id),
          localTable: "profiles",
          localId: localUserId,
        });
      }
    }

    let firstVenueId: string | null = Array.from(venueLocalByExternalId.values())[0] ?? null;
    if (!firstVenueId) {
      const { data: accountFirstVenue } = await adminClient
        .from("venues")
        .select("id")
        .eq("account_id", data.accountId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      firstVenueId = (accountFirstVenue as { id?: string } | null)?.id ?? null;
    }

    if (firstVenueId) {
      await adminClient
        .from("user_venue_roles")
        .upsert(
          {
            user_id: user.id,
            venue_id: firstVenueId,
            role_id: ownerRoleId,
            status: "active",
          },
          { onConflict: "user_id,venue_id" }
        );
      await adminClient.from("profiles").update({ active_venue_id: firstVenueId }).eq("id", user.id);
    }

    const hasErrors = summary.errors.length > 0;
    const hasSkips =
      summary.skippedBlockedEmployees > 0 ||
      summary.skippedNoEmailEmployees > 0 ||
      summary.skippedMissingRoleEmployees > 0 ||
      summary.skippedNoVenueEmployees > 0;

    const status: "success" | "partial" = hasErrors || hasSkips ? "partial" : "success";

    await adminDb
      .from("integration_import_runs")
      .update({
        status,
        summary,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { runId, summary, status, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Импорт завершился с ошибкой";

    await adminDb
      .from("integration_import_runs")
      .update({
        status: "failed",
        error_text: errorMessage,
        summary,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return { runId, summary, status: "failed", error: errorMessage };
  }
}
