"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { HiringOptions, ConnectionView } from "@/lib/candidates/types";
import {
  candidateConnection,
  saveCandidateConnection,
  candidateEmploymentSettings,
  saveCandidateEmploymentSettings,
} from "../actions";
import { Field, FieldSelect } from "./fields";
export function RecruitingSettings({
  options,
  onClose,
}: {
  options: HiringOptions;
  onClose: () => void;
}) {
  const [connection, setConnection] = useState<ConnectionView>(null),
    [loaded, setLoaded] = useState(false),
    [enabled, setEnabled] = useState(false),
    [form, setForm] = useState(""),
    [chat, setChat] = useState(""),
    [token, setToken] = useState(""),
    [secret, setSecret] = useState(""),
    [url, setUrl] = useState(""),
    [busy, start] = useTransition(),
    [error, setError] = useState("");
  const [venue, setVenue] = useState(options.venues[0]?.id ?? ""),
    [stores, setStores] = useState("1"),
    [masterStores, setMasterStores] = useState("16"),
    [group, setGroup] = useState("8"),
    [accountType, setAccountType] = useState("1"),
    [codes, setCodes] = useState(""),
    [poolReady, setPoolReady] = useState(false),
    [emptyPool, setEmptyPool] = useState(false),
    [employmentLoaded, setEmploymentLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    candidateConnection()
      .then((c) => {
        if (!active) return;
        setConnection(c);
        if (c) {
          setEnabled(c.enabled);
          setForm(c.form_id);
          setChat(c.telegram_chat_id ?? "");
          setUrl(
            new URL(
              `/api/webhooks/tilda/candidates/${c.id}`,
              window.location.origin,
            ).toString(),
          );
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить настройки",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!venue) return;
    let active = true;
    setEmploymentLoaded(false);
    candidateEmploymentSettings(venue)
      .then((s) => {
        if (!active) return;
        setStores((s?.store_ids ?? [1]).join(", "));
        setMasterStores((s?.master_store_ids ?? [16]).join(", "));
        setGroup(String(s?.staff_group_id ?? 8));
        setAccountType(String(s?.bonus_account_type_id ?? 1));
        setPoolReady(s?.office_pool_initialized ?? false);
        setCodes("");
        setEmptyPool(false);
        setEmploymentLoaded(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить настройки",
          );
      });
    return () => {
      active = false;
    };
  }, [venue]);
  const save = (rotate = false) =>
    start(async () => {
      try {
        const next = await saveCandidateConnection({
          enabled,
          form_id: form,
          telegram_chat_id: chat,
          telegram_token: token || undefined,
          rotate,
        });
        setToken("");
        if (next.secret) setSecret(next.secret);
        setUrl(
          new URL(
            `/api/webhooks/tilda/candidates/${next.id}`,
            window.location.origin,
          ).toString(),
        );
        setConnection(await candidateConnection());
        toast.success("Приём заявок настроен");
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось сохранить настройки",
        );
      }
    });
  const saveEmployment = () =>
    start(async () => {
      try {
        const parse = (s: string) =>
          s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map(Number);
        const r = await saveCandidateEmploymentSettings(venue, {
          store_ids: parse(stores),
          master_store_ids: parse(masterStores),
          staff_group_id: Number(group),
          bonus_account_type_id: Number(accountType),
          legacy_codes: codes || undefined,
          confirm_empty_pool: emptyPool,
        });
        setCodes("");
        setPoolReady(
          (await candidateEmploymentSettings(venue))?.office_pool_initialized ??
            false,
        );
        toast.success(
          r.imported
            ? `Сохранены занятые коды: ${r.imported}`
            : "Настройки найма сохранены",
        );
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Не удалось сохранить настройки",
        );
      }
    });
  return (
    <EditDrawer
      open
      title="Настройки кандидатов"
      description="Анкеты с сайта и оформление сотрудников"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Tabs defaultValue="tilda">
        <TabsList>
          <TabsTrigger value="tilda">Анкеты с сайта</TabsTrigger>
          <TabsTrigger value="hire">Оформление сотрудника</TabsTrigger>
        </TabsList>
        <TabsContent value="tilda" className="mt-5 space-y-5">
          {!loaded ? (
            <p className="text-sm text-muted-foreground">
              Загружаем настройки…
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={(v) => setEnabled(v === true)}
                />
                Принимать анкеты из Тильды
              </label>
              <Field label="Форма Тильды">
                <Input
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                  placeholder="form356864639"
                />
              </Field>
              <Field label="Telegram-чат для новых анкет">
                <Input
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                  placeholder="ID текущего чата"
                />
              </Field>
              <Field
                label={
                  connection?.telegram_configured
                    ? "Токен бота · сохранён, можно заменить"
                    : "Токен Telegram-бота"
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    connection?.telegram_configured ? "••••••••" : "Токен бота"
                  }
                />
              </Field>
              <Button disabled={busy} onClick={() => save(false)}>
                Сохранить настройки
              </Button>
              {url ? (
                <>
                  <Field label="Адрес webhook">
                    <Input
                      readOnly
                      value={url}
                      onFocus={(e) => e.target.select()}
                    />
                  </Field>
                  {secret ? (
                    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <Field label="Ключ доступа · показывается сейчас">
                        <Input
                          readOnly
                          value={secret}
                          onFocus={(e) => e.target.select()}
                        />
                      </Field>
                      <p className="text-xs text-muted-foreground">
                        Скопируйте ключ в Тильду. После закрытия окна его можно
                        только заменить.
                      </p>
                    </div>
                  ) : null}
                  <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                    <li>
                      В Тильде откройте настройки сайта → Формы → Webhook.
                    </li>
                    <li>
                      Укажите адрес выше. В настройках API выберите передачу в
                      заголовке, имя <strong>x-tilda-key</strong> и
                      скопированный ключ.
                    </li>
                    <li>
                      Подключите этот приёмщик только к анкете кандидата.
                      Отключите для неё старый webhook n8n и опубликуйте
                      страницу.
                    </li>
                  </ol>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Старый ключ перестанет работать. После замены обновите его в Тильде.",
                        )
                      )
                        save(true);
                    }}
                  >
                    Заменить ключ доступа
                  </Button>
                </>
              ) : null}
              {connection?.last_received_at ? (
                <p className="text-xs text-muted-foreground">
                  Последняя заявка:{" "}
                  {new Date(connection.last_received_at).toLocaleString(
                    "ru-RU",
                  )}{" "}
                  · В обработке: {connection.pending_jobs}
                  {connection.failed_jobs
                    ? ` · Требуют проверки: ${connection.failed_jobs}`
                    : ""}
                </p>
              ) : null}
            </>
          )}
        </TabsContent>
        <TabsContent value="hire" className="mt-5 space-y-5">
          <FieldSelect
            label="Заведение"
            value={venue}
            onChange={setVenue}
            options={options.venues.map((v) => ({
              value: v.id,
              label: v.name,
            }))}
          />
          {employmentLoaded ? (
            <>
              <p className="text-sm text-muted-foreground">
                Настройки повторяют создание сотрудника из Glide: Quick Resto,
                PIN, склады, гость, бонусный счёт и код офисного замка.
              </p>
              <Field label="Склады Quick Resto для всех сотрудников · ID через запятую">
                <Input
                  value={stores}
                  onChange={(e) => setStores(e.target.value)}
                />
              </Field>
              <Field label="Дополнительные склады для мастеров · ID через запятую">
                <Input
                  value={masterStores}
                  onChange={(e) => setMasterStores(e.target.value)}
                />
              </Field>
              <Field label="Группа гостей «Сотрудники» · ID в Quick Resto">
                <Input
                  type="number"
                  min={1}
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
              </Field>
              <Field label="Тип бонусного счёта · ID в Quick Resto">
                <Input
                  type="number"
                  min={1}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                />
              </Field>
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-base font-semibold">Офисный замок</h3>
                <p className="text-sm text-muted-foreground">
                  {poolReady
                    ? "Занятые коды перенесены. Можно дополнить список."
                    : "Перед первым наймом перенесите занятые номера и коды из старой системы."}
                </p>
                <Field label="Занятые номера и коды · одна пара в строке">
                  <Textarea
                    autoComplete="off"
                    value={codes}
                    onChange={(e) => setCodes(e.target.value)}
                    placeholder={
                      "Номер пользователя → код\nВставьте два столбца из старой системы"
                    }
                    rows={5}
                  />
                </Field>
                {!poolReady ? (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={emptyPool}
                      onCheckedChange={(v) => setEmptyPool(v === true)}
                    />
                    В этом аккаунте ещё нет выданных кодов замка
                  </label>
                ) : null}
              </div>
              <Button disabled={busy} onClick={saveEmployment}>
                Сохранить настройки найма
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Загружаем настройки…
            </p>
          )}
        </TabsContent>
      </Tabs>
    </EditDrawer>
  );
}
