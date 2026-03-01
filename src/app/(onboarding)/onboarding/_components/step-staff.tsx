"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserPlus, Users, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">

      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-50">
        <div className="flex items-center justify-between mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
            Шаг 4 из 5
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Пригласить сотрудников</h1>
        <p className="text-sm text-gray-500">Необязательный шаг — можно добавить позже в настройках</p>
      </div>

      {/* Body */}
      <div className="px-8 py-6 space-y-5">

        {/* Invited list */}
        {invited.length > 0 && (
          <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-2">
            {invited.map((inv) => (
              <div key={inv.email} className="flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                <span className="flex-1 truncate text-sm text-gray-700">{inv.email}</span>
                <span className="text-xs font-medium text-gray-500 bg-white border border-gray-200
                                 px-2.5 py-0.5 rounded-full shrink-0">
                  {inv.roleName}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
              Email сотрудника
            </label>
            <input
              id="email"
              type="email"
              placeholder="employee@example.com"
              className={`h-12 w-full rounded-xl border px-4 text-sm
                         placeholder:text-gray-400 outline-none transition-colors duration-150
                         ${errors.email
                           ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                           : "border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                         }`}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Роль</label>
            <Select onValueChange={(v) => setValue("roleId", v)}>
              <SelectTrigger className={`h-12 rounded-xl text-sm transition-colors duration-150
                ${errors.roleId
                  ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                  : "border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                }`}
              >
                <SelectValue placeholder="Выберите роль" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-gray-100 shadow-lg">
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.roleId && (
              <p className="text-xs text-red-600">{errors.roleId.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl border border-gray-200 bg-white hover:bg-gray-50
                       text-gray-700 text-sm font-medium transition-colors duration-150
                       flex items-center justify-center gap-2
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <UserPlus className="w-4 h-4" />
            }
            Отправить приглашение
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="px-8 pb-8 flex gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="h-12 flex-1 rounded-xl hover:bg-gray-100 text-gray-500 text-sm font-medium
                     transition-colors duration-150"
        >
          Пропустить
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={invited.length === 0}
          className="h-12 flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm
                     font-medium transition-colors duration-150
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {invited.length > 0 ? `Далее (${invited.length})` : "Далее"}
        </button>
      </div>
    </div>
  );
}
