"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvitationEmail } from "@/lib/invitations/mailer";
import type { Json, VenueType, WorkingHours } from "@/types/database";
import { randomUUID } from "crypto";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  listEmployees,
  listRoles,
  listTableSchemes,
  readEmployee,
  readTableScheme,
  type QuickRestoEmployeeRead,
  type QuickRestoTableScheme,
} from "@/lib/integrations/quickresto/client";

type LooseQueryResult = { data: unknown; error: { message: string } | null };
type LooseQueryBuilder = {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  maybeSingle: () => Promise<LooseQueryResult>;
  single: () => Promise<LooseQueryResult>;
  insert: (values: unknown) => LooseQueryBuilder;
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQueryBuilder;
  update: (values: unknown) => LooseQueryBuilder;
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
}): Promise<{ accountId: string | null; venueId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { accountId: null, venueId: null, error: "Не авторизован" };

  const { data: existingAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (existingAccount?.id) {
    const { data: insertedVenue, error: venueError } = await supabase
      .from("venues")
      .insert({
        account_id: existingAccount.id,
        name: data.venueName,
        type: data.venueType,
        address: data.venueAddress || null,
        phone: data.venuePhone || null,
        website: data.venueWebsite || null,
        currency: data.currency,
        timezone: data.timezone,
        working_hours: data.workingHours as unknown as Json,
      })
      .select("id")
      .single();

    if (venueError || !insertedVenue?.id) {
      return { accountId: existingAccount.id, venueId: null, error: venueError?.message ?? "Не удалось создать заведение" };
    }

    const { data: ownerRole } = await supabase
      .from("roles")
      .select("id")
      .is("account_id", null)
      .eq("code", "owner")
      .maybeSingle();

    if (ownerRole?.id) {
      await supabase
        .from("user_venue_roles")
        .upsert(
          {
            user_id: user.id,
            venue_id: insertedVenue.id,
            role_id: ownerRole.id,
            status: "active",
          },
          { onConflict: "user_id,venue_id" }
        );
    }

    await supabase
      .from("profiles")
      .update({ active_venue_id: insertedVenue.id })
      .eq("id", user.id);

    return { accountId: existingAccount.id, venueId: insertedVenue.id, error: null };
  }

  const { data: result, error } = await supabase.rpc("complete_owner_onboarding", {
    p_account_name:  data.accountName,
    p_account_logo:  data.accountLogoUrl ?? "",
    p_venue_name:    data.venueName,
    p_venue_type:    data.venueType,
    p_venue_address: data.venueAddress,
    p_venue_phone:   data.venuePhone,
    p_venue_website: data.venueWebsite,
    p_currency:      data.currency,
    p_timezone:      data.timezone,
    p_working_hours: data.workingHours as unknown as Json,
  });

  if (error) return { accountId: null, venueId: null, error: error.message };

  const rpcResult = result as { account_id: string; venue_id: string };
  return {
    accountId: rpcResult.account_id,
    venueId:   rpcResult.venue_id,
    error:     null,
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
  const resendApiKey = process.env.RESEND_API_KEY ?? process.env.SMTP_PASS;

  // Fallback: if Resend API key is not configured, use built-in Supabase emails.
  // The `redirectTo` in Supabase emails is where the user lands after token verification.
  if (!resendApiKey) {
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

// Получение системных ролей (для выбора в онбординге)
export async function getSystemRoles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, code")
    .is("account_id", null)
    .neq("code", "owner")
    .order("name");

  if (error) return [];
  return data ?? [];
}

type QuickRestoProvider = "quickresto";

type ImportSummary = {
  venuesCreated: number;
  venuesUpdated: number;
  rolesCreated: number;
  rolesUpdated: number;
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
    .is("account_id", null)
    .eq("code", "owner")
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertExternalLink(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
  entityType: "venue" | "role" | "staff";
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

async function findExternalLinkLocalId(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
  entityType: "venue" | "role" | "staff";
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

async function getConnectionById(params: {
  client: unknown;
  connectionId: string;
}) {
  const db = asLooseClient(params.client);
  const { data, error } = await db
    .from("integration_connections")
    .select("id, account_id, provider, login, password_encrypted, password_iv, password_tag")
    .eq("id", params.connectionId)
    .maybeSingle();

  if (error || !data) return null;
  return data as {
    id: string;
    account_id: string;
    provider: QuickRestoProvider;
    login: string;
    password_encrypted: string;
    password_iv: string;
    password_tag: string;
  };
}

async function getConnectionByAccount(params: {
  client: unknown;
  accountId: string;
  provider: QuickRestoProvider;
}) {
  const db = asLooseClient(params.client);
  const { data, error } = await db
    .from("integration_connections")
    .select("id, account_id, provider, login, password_encrypted, password_iv, password_tag")
    .eq("account_id", params.accountId)
    .eq("provider", params.provider)
    .maybeSingle();

  if (error || !data) return null;
  return data as {
    id: string;
    account_id: string;
    provider: QuickRestoProvider;
    login: string;
    password_encrypted: string;
    password_iv: string;
    password_tag: string;
  };
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

  const encrypted = encryptSecret(data.password);

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

    if (data.importRoles && selectedRoleIdSet.size > 0) {
      const roles = await listRoles({
        layerName: connection.login,
        login: connection.login,
        password,
      });

      const selectedRoles = roles.filter((role) => selectedRoleIdSet.has(String(role.id)));

      for (const role of selectedRoles) {
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
            .eq("id", existingRoleLink.local_id)
            .eq("account_id", data.accountId);

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
              account_id: data.accountId,
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

          const { data: insertedFallbackRole, error: insertFallbackRoleError } = await adminClient
            .from("roles")
            .upsert(
              {
                account_id: data.accountId,
                name: fallbackRoleName,
                code: fallbackRoleCode,
                comment: "Создано автоматически на основе импорта сотрудников из Quick Resto",
              },
              { onConflict: "code,account_id" }
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
            terminal_pin: pin,
          })
          .eq("id", localUserId);

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
