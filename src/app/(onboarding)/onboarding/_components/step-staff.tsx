"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserPlus, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { sendInvitation } from "../actions";

const schema = z.object({
  email:  z.string().email("Некорректный email"),
  roleId: z.string().min(1, "Выберите роль"),
});

type Form = z.infer<typeof schema>;

interface Invited {
  email: string;
  roleName: string;
}

interface Props {
  venueId: string;
  roles: { id: string; name: string; code: string }[];
  onNext: () => void;
  onSkip: () => void;
}

export function StepStaff({ venueId, roles, onNext, onSkip }: Props) {
  const [invited, setInvited] = useState<Invited[]>([]);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", roleId: "" },
  });

  const onSubmit = async (values: Form) => {
    setLoading(true);
    const { error } = await sendInvitation({
      email: values.email,
      roleId: values.roleId,
      venueId,
    });
    setLoading(false);

    if (error) {
      toast.error(error);
      return;
    }

    const role = roles.find((r) => r.id === values.roleId);
    setInvited((prev) => [...prev, { email: values.email, roleName: role?.name ?? "" }]);
    toast.success(`Приглашение отправлено на ${values.email}`);
    reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Пригласить сотрудников</CardTitle>
        <CardDescription>
          Необязательный шаг. Можно пропустить и добавить позже в настройках.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Список приглашённых */}
        {invited.length > 0 && (
          <div className="space-y-2">
            {invited.map((inv) => (
              <div
                key={inv.email}
                className="flex items-center gap-2 p-2 rounded-md bg-muted text-sm"
              >
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                <span className="flex-1 truncate">{inv.email}</span>
                <Badge variant="secondary">{inv.roleName}</Badge>
              </div>
            ))}
          </div>
        )}

        {/* Форма */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email сотрудника</Label>
            <Input
              id="email"
              type="email"
              placeholder="employee@example.com"
              {...register("email")}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Роль</Label>
            <Select onValueChange={(v) => setValue("roleId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите роль" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.roleId && <p className="text-sm text-destructive">{errors.roleId.message}</p>}
          </div>

          <Button type="submit" variant="outline" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Отправить приглашение
          </Button>
        </form>
      </CardContent>

      <div className="px-6 pb-6 flex gap-3">
        <Button variant="ghost" onClick={onSkip} className="flex-1">
          Пропустить
        </Button>
        <Button onClick={onNext} className="flex-1" disabled={invited.length === 0}>
          {invited.length > 0 ? `Далее (${invited.length})` : "Далее"}
        </Button>
      </div>
    </Card>
  );
}
