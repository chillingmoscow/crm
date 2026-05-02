"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createCounterparty } from "@/lib/finance/counterparties";
import type { CounterpartyRow } from "@/types/finance";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
};

const LEGAL_FORMS: { value: CounterpartyRow["legal_form"]; label: string }[] = [
  { value: "OOO",   label: "ООО" },
  { value: "IP",    label: "ИП" },
  { value: "AO",    label: "АО" },
  { value: "PAO",   label: "ПАО" },
  { value: "NKO",   label: "НКО" },
  { value: "OTHER", label: "Прочее" },
];

export function CounterpartyFormSheet({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [legalForm, setLegalForm] = useState<CounterpartyRow["legal_form"]>("OOO");
  const [inn, setInn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setLegalForm("OOO");
      setInn("");
      setPhone("");
      setEmail("");
      setDescription("");
    }
  }, [open]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название контрагента");
      return;
    }
    setSaving(true);
    const { id, error } = await createCounterparty({
      name: name.trim(),
      legal_form: legalForm,
      inn: inn.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      description: description.trim() || null,
    });
    setSaving(false);
    if (error || !id) {
      toast.error(error ?? "Не удалось создать контрагента");
      return;
    }
    toast.success("Контрагент создан");
    onCreated(id);
  };

  return (
    <EditDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Новый контрагент"
      description="Поставщик, клиент или подрядчик. Применяется в этой операции."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="cp-name">
          Название <span className="text-destructive">*</span>
        </Label>
        <Input
          id="cp-name"
          placeholder="Например: ООО Поставщик"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>Правовая форма</Label>
        <Select
          value={legalForm}
          onValueChange={(v) => setLegalForm(v as CounterpartyRow["legal_form"])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEGAL_FORMS.map((lf) => (
              <SelectItem key={lf.value} value={lf.value}>
                {lf.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cp-inn">ИНН</Label>
        <Input
          id="cp-inn"
          placeholder="10 или 12 цифр"
          value={inn}
          onChange={(e) => setInn(e.target.value)}
          inputMode="numeric"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cp-phone">Телефон</Label>
        <Input
          id="cp-phone"
          placeholder="+7 (___) ___-__-__"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cp-email">Email</Label>
        <Input
          id="cp-email"
          type="email"
          placeholder="info@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cp-desc">Описание</Label>
        <Textarea
          id="cp-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Необязательно — например, контакт менеджера или комментарий"
        />
      </div>
    </EditDrawer>
  );
}
