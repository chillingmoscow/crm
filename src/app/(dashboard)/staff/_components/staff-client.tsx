"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus, Trash2, Mail, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { inviteStaff, updateStaffRole, removeStaff } from "../actions";
import type { StaffMember } from "../actions";

const inviteSchema = z.object({
  email:  z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите должность"),
});

type InviteForm = z.infer<typeof inviteSchema>;

type Role = { id: string; name: string; code: string };

type Props = {
  staff:         StaffMember[];
  roles:         Role[];
  venueId:       string;
  currentUserId: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  });
}

function displayName(member: StaffMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ");
  return name || member.email.split("@")[0];
}

export function StaffClient({
  staff: initialStaff,
  roles,
  venueId,
  currentUserId,
}: Props) {
  const [staff, setStaff] = useState(initialStaff);
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [confirmId, setConfirmId]       = useState<string | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [isPending, startTransition]    = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({ resolver: zodResolver(inviteSchema) });

  const onInvite = (values: InviteForm) => {
    startTransition(async () => {
      const result = await inviteStaff({
        email:   values.email,
        roleId:  values.roleId,
        venueId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Приглашение отправлено на ${values.email}`);
      reset();
      setSheetOpen(false);
    });
  };

  const onRoleChange = (uvrId: string, newRoleId: string) => {
    startTransition(async () => {
      const result = await updateStaffRole(uvrId, newRoleId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const role = roles.find((r) => r.id === newRoleId);
      setStaff((prev) =>
        prev.map((m) =>
          m.uvr_id === uvrId
            ? { ...m, role_id: newRoleId, role_name: role?.name ?? m.role_name, role_code: role?.code ?? m.role_code }
            : m
        )
      );
      setEditingRoleId(null);
      toast.success("Должность обновлена");
    });
  };

  const onRemove = (uvrId: string) => {
    startTransition(async () => {
      const result = await removeStaff(uvrId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setStaff((prev) => prev.filter((m) => m.uvr_id !== uvrId));
      setConfirmId(null);
      toast.success("Сотрудник удалён");
    });
  };

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Сотрудники</h1>
          <p className="text-muted-foreground mt-1">
            {staff.length > 0
              ? `${staff.length} ${staff.length === 1 ? "сотрудник" : staff.length < 5 ? "сотрудника" : "сотрудников"}`
              : "Нет сотрудников"}
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)} size="sm">
          <UserPlus className="w-4 h-4 mr-1.5" />
          Пригласить
        </Button>
      </div>

      {/* Staff table */}
      {staff.length === 0 ? (
        <div className="rounded-lg border border-dashed flex flex-col items-center justify-center p-16 text-center">
          <UserPlus className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Нет сотрудников</p>
          <p className="text-sm text-muted-foreground mt-1">
            Пригласите первого сотрудника в заведение
          </p>
          <Button
            onClick={() => setSheetOpen(true)}
            size="sm"
            className="mt-4"
          >
            <UserPlus className="w-4 h-4 mr-1.5" />
            Пригласить
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_160px_auto] gap-4 px-4 py-3 bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide border-b">
            <span>Сотрудник</span>
            <span>Email</span>
            <span>Должность</span>
            <span className="w-20 text-right">Добавлен</span>
          </div>

          {/* Rows */}
          {staff.map((member, i) => {
            const isMe = member.user_id === currentUserId;
            const isEditingThisRole = editingRoleId === member.uvr_id;
            const isConfirmDelete   = confirmId === member.uvr_id;

            return (
              <div key={member.uvr_id}>
                {i > 0 && <Separator />}
                <div className="grid grid-cols-[1fr_1fr_160px_auto] gap-4 items-center px-4 py-3 hover:bg-muted/30 transition-colors">
                  {/* Name */}
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {displayName(member)}
                      {isMe && (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          (вы)
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Email */}
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{member.email}</span>
                  </div>

                  {/* Role */}
                  <div>
                    {isEditingThisRole ? (
                      <Select
                        defaultValue={member.role_id}
                        onValueChange={(v) => onRoleChange(member.uvr_id, v)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <button
                        onClick={() =>
                          !isMe && setEditingRoleId(member.uvr_id)
                        }
                        disabled={isMe}
                        className="text-left"
                      >
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            !isMe
                              ? "cursor-pointer hover:bg-accent"
                              : "cursor-default"
                          }`}
                        >
                          {member.role_name}
                        </Badge>
                      </button>
                    )}
                  </div>

                  {/* Date + delete */}
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDate(member.joined_at)}
                    </span>
                    {!isMe && (
                      <>
                        {isConfirmDelete ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs px-2"
                              disabled={isPending}
                              onClick={() => onRemove(member.uvr_id)}
                            >
                              Удалить
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2"
                              onClick={() => setConfirmId(null)}
                            >
                              Отмена
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmId(member.uvr_id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invite Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Пригласить сотрудника</SheetTitle>
          </SheetHeader>

          <form
            onSubmit={handleSubmit(onInvite)}
            className="mt-6 space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email сотрудника *</Label>
              <Input
                id="email"
                type="email"
                placeholder="employee@example.com"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Должность *</Label>
              <Select onValueChange={(v) => setValue("roleId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите должность" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.roleId && (
                <p className="text-sm text-destructive">
                  {errors.roleId.message}
                </p>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              Сотруднику будет отправлено приглашение на указанный email.
            </p>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setSheetOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" className="flex-1" disabled={isPending}>
                Отправить приглашение
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
