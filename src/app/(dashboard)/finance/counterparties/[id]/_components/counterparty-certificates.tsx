"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileSection } from "@/components/shared/profile-section";
import { CERTIFICATE_KINDS, certificateKindLabel, certificateStatus } from "@/lib/finance/certificates";
import {
  deleteCertificate,
  saveCertificate,
  type CounterpartyCertificate,
} from "@/lib/finance/certificates-actions";
import { getFileDownloadUrl } from "@/lib/files/signed-urls";
import { CERTIFICATES_CHANGED_EVENT } from "@/lib/finance/use-certificate-alert-count";
import { formatDateCell } from "@/lib/format/date";
import type { CounterpartyDocument } from "./counterparty-documents";
import { DocumentPreviewDialog } from "./document-preview-dialog";


type Draft = {
  id: string | null;
  kind: string;
  number: string;
  product: string;
  validFrom: string;
  validUntil: string;
  fileId: string;
  note: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  kind: "conformity_certificate",
  number: "",
  product: "",
  validFrom: "",
  validUntil: "",
  fileId: "",
  note: "",
});

const draftFrom = (c: CounterpartyCertificate): Draft => ({
  id: c.id,
  kind: c.kind,
  number: c.number ?? "",
  product: c.product ?? "",
  validFrom: c.validFrom ?? "",
  validUntil: c.validUntil ?? "",
  fileId: c.fileId ?? "",
  note: c.note ?? "",
});

const TONE = { expired: "danger", expiring: "warning", ok: "success", none: "neutral" } as const;

/**
 * Сертификаты соответствия, декларации и лицензии контрагента со сроком.
 * За 30 и за 7 дней до конца срока приходит напоминание; скан выбирается
 * из документов контрагента ниже.
 */
export function CounterpartyCertificates({
  counterpartyId,
  certificates,
  documents,
  today,
  readOnly,
  lockMessage,
  failed = false,
}: {
  counterpartyId: string;
  certificates: CounterpartyCertificate[];
  documents: CounterpartyDocument[];
  /** Сегодня (`ГГГГ-ММ-ДД`) с сервера — для статуса срока. */
  today: string;
  readOnly: boolean;
  lockMessage: string | null;
  failed?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CounterpartyDocument | null>(null);

  const download = async (doc: CounterpartyDocument) => {
    const { url, error: urlError } = await getFileDownloadUrl(doc.fileId).catch(() => ({
      url: null,
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    if (!url) {
      toast.error(urlError ?? "Не удалось скачать файл");
      return;
    }
    window.location.assign(url);
  };

  const documentById = new Map(documents.map((d) => [d.fileId, d]));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const changed = () => {
    window.dispatchEvent(new Event(CERTIFICATES_CHANGED_EVENT));
    router.refresh();
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await saveCertificate({
      id: draft.id,
      counterpartyId,
      kind: draft.kind,
      number: draft.number,
      product: draft.product,
      validFrom: draft.validFrom || null,
      validUntil: draft.validUntil || null,
      fileId: draft.fileId || null,
      note: draft.note,
    }).catch(() => ({ error: "Нет связи с сервером. Проверьте соединение и повторите" }));
    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    toast.success(draft.id ? "Изменения сохранены" : "Документ добавлен");
    setDraft(null);
    changed();
  };

  const remove = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    setDeleteError(null);
    const { error: removeError } = await deleteCertificate(deleteTarget.id).catch(() => ({
      error: "Нет связи с сервером. Проверьте соединение и повторите",
    }));
    setDeleting(false);
    if (removeError) {
      setDeleteError(removeError);
      return;
    }
    toast.success("Документ удалён");
    setDeleteTarget(null);
    setDraft(null);
    changed();
  };

  return (
    <ProfileSection
      title="Сертификаты и лицензии"
      description="Сертификаты соответствия, декларации и лицензии на алкоголь. За 30 и за 7 дней до конца срока придёт напоминание"
      locked={readOnly && lockMessage ? { tone: "locked", message: lockMessage } : undefined}
    >
      <div className="flex flex-col gap-3">
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            Не удалось загрузить сертификаты. Обновите страницу
          </p>
        ) : certificates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сертификатов и лицензий пока нет</p>
        ) : (
          <ul className="space-y-2">
            {certificates.map((certificate) => {
              const status = certificateStatus(certificate.validUntil, today);
              const file = certificate.fileId ? documentById.get(certificate.fileId) : undefined;
              const title = `${certificateKindLabel(certificate.kind)}${certificate.number ? ` № ${certificate.number}` : ""}`;
              const period = certificate.validUntil
                ? `${certificate.validFrom ? `с ${formatDateCell(certificate.validFrom)} ` : ""}до ${formatDateCell(certificate.validUntil)}`
                : "бессрочно";
              return (
                <li key={certificate.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <BadgeCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {readOnly ? (
                      <span className="block truncate text-sm font-medium" data-tip={title}>
                        {title}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-medium transition-colors duration-200 hover:text-brand"
                        onClick={() => {
                          setError(null);
                          setDraft(draftFrom(certificate));
                        }}
                        data-tip={title}
                      >
                        {title}
                      </button>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">
                      {[certificate.product ? `на «${certificate.product}»` : null, period].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {status.tone !== "ok" && status.tone !== "none" ? (
                    <StatusBadge tone={TONE[status.tone]}>{status.label}</StatusBadge>
                  ) : null}
                  {file ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="touch-target size-8 text-muted-foreground"
                      onClick={() => setPreview(file)}
                      aria-label={`Открыть скан ${file.name}`}
                      data-tip={`Скан: ${file.name}`}
                    >
                      <FileText className="size-4" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && !failed ? (
          <div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => {
                setError(null);
                setDraft(emptyDraft());
              }}
            >
              <Plus className="size-4" />
              Добавить сертификат или лицензию
            </Button>
          </div>
        ) : null}
      </div>

      <EditDrawer
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDraft(null);
        }}
        title={draft?.id ? "Сертификат или лицензия" : "Новый сертификат или лицензия"}
        footer={
          <>
            {draft?.id ? (
              <Button
                variant="ghost"
                size="icon"
                className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Удалить"
                data-tip="Удалить"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteTarget(draft);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Отмена
            </Button>
            <Button className="min-w-32" onClick={() => void save()} disabled={saving}>
              {saving ? "Сохраняем…" : draft?.id ? "Сохранить" : "Добавить"}
            </Button>
          </>
        }
      >
        {draft ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!saving) void save();
            }}
          >
            <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />
            <Field id="cert-kind" label="Вид" required>
              {(control) => (
                <OptionSelect
                  {...control}
                  value={draft.kind}
                  onValueChange={(value) => set("kind", value)}
                  options={CERTIFICATE_KINDS}
                />
              )}
            </Field>
            <Field id="cert-number" label="Номер">
              {(control) => (
                <Input
                  {...control}
                  value={draft.number}
                  onChange={(event) => set("number", event.target.value)}
                  placeholder="РОСС RU.Д-RU.РА01.В.12345/26"
                  maxLength={100}
                />
              )}
            </Field>
            <Field id="cert-product" label="На какой товар" hint="Свободным текстом: «молоко 3,2%», «всё вино», «пиво разливное»">
              {(control) => (
                <Input
                  {...control}
                  value={draft.product}
                  onChange={(event) => set("product", event.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cert-from" label="Действует с">
                {(control) => (
                  <DatePicker {...control} value={draft.validFrom} onChange={(value) => set("validFrom", value)} />
                )}
              </Field>
              <Field id="cert-until" label="Действует до" hint="Пусто — бессрочный, без напоминаний">
                {(control) => (
                  <DatePicker {...control} value={draft.validUntil} onChange={(value) => set("validUntil", value)} />
                )}
              </Field>
            </div>
            <Field
              id="cert-file"
              label="Скан"
              hint={
                documents.length === 0
                  ? "Скан выбирают из документов контрагента ниже — сейчас там нет доступных вам файлов"
                  : "Один из документов контрагента"
              }
            >
              {(control) => (
                <OptionSelect
                  {...control}
                  value={draft.fileId}
                  onValueChange={(value) => set("fileId", value)}
                  options={[
                    { value: "", label: "Без скана" },
                    ...documents.map((d) => ({ value: d.fileId, label: d.name })),
                    // Нет права смотреть документы — сохранённый скан не теряем.
                    ...(draft.fileId && !documentById.has(draft.fileId)
                      ? [{ value: draft.fileId, label: "Прикреплён (файл вам не виден)" }]
                      : []),
                  ]}
                  disabled={documents.length === 0}
                />
              )}
            </Field>
            <Field id="cert-note" label="Заметка">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={2000}
                  value={draft.note}
                  onChange={(event) => set("note", event.target.value)}
                />
              )}
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </EditDrawer>

      <DocumentPreviewDialog
        document={preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onDownload={(doc) => void download(doc)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title="Удалить запись?"
        description="Сертификат или лицензия удалится из карточки, напоминаний по нему не будет. Скан останется в документах."
        confirmLabel="Удалить"
        pendingLabel="Удаляем…"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
      />
    </ProfileSection>
  );
}
