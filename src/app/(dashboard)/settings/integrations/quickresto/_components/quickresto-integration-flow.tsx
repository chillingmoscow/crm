"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepQuickRestoBackOfficeCredentials } from "@/app/(onboarding)/onboarding/_components/step-quickresto-backoffice-credentials";
import { StepQuickRestoBotEmployee } from "@/app/(onboarding)/onboarding/_components/step-quickresto-bot-employee";
import { StepQuickRestoBotRole } from "@/app/(onboarding)/onboarding/_components/step-quickresto-bot-role";
import { StepQuickRestoCredentials } from "@/app/(onboarding)/onboarding/_components/step-quickresto-credentials";
import { StepQuickRestoImport } from "@/app/(onboarding)/onboarding/_components/step-quickresto-import";
import { StepQuickRestoOptions } from "@/app/(onboarding)/onboarding/_components/step-quickresto-options";

interface Props {
  accountId: string;
  initialLogin: string;
  initialConnectionId: string | null;
  initialBackOfficeLogin?: string | null;
  initialBotRoleExternalId?: number | null;
  initialBotEmployeeExternalId?: number | null;
}

type QuickRestoState = {
  quickRestoLogin: string;
  quickRestoConnectionId: string | null;
  quickRestoBackOfficeLogin: string;
  quickRestoBotRoleExternalId: number | null;
  quickRestoBotEmployeeExternalId: number | null;
  importVenues: boolean;
  importRoles: boolean;
  importEmployees: boolean;
  importStores: boolean;
  importIngredientGroups: boolean;
  importIngredients: boolean;
  selectedVenueExternalIds: number[];
  selectedRoleExternalIds: number[];
  selectedEmployeeExternalIds: number[];
};

const INITIAL_STATE: QuickRestoState = {
  quickRestoLogin: "",
  quickRestoConnectionId: null,
  quickRestoBackOfficeLogin: "",
  quickRestoBotRoleExternalId: null,
  quickRestoBotEmployeeExternalId: null,
  importVenues: true,
  importRoles: true,
  importEmployees: true,
  importStores: true,
  importIngredientGroups: true,
  importIngredients: true,
  selectedVenueExternalIds: [],
  selectedRoleExternalIds: [],
  selectedEmployeeExternalIds: [],
};

export function QuickRestoIntegrationFlow({
  accountId,
  initialLogin,
  initialConnectionId,
  initialBackOfficeLogin,
  initialBotRoleExternalId,
  initialBotEmployeeExternalId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<QuickRestoState>({
    ...INITIAL_STATE,
    quickRestoLogin: initialLogin,
    quickRestoConnectionId: initialConnectionId,
    quickRestoBackOfficeLogin: initialBackOfficeLogin ?? "",
    quickRestoBotRoleExternalId: initialBotRoleExternalId ?? null,
    quickRestoBotEmployeeExternalId: initialBotEmployeeExternalId ?? null,
  });

  const update = (patch: Partial<QuickRestoState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div className="max-w-[520px]">
      {step === 1 ? (
        <StepQuickRestoCredentials
          accountId={accountId}
          initialLogin={state.quickRestoLogin}
          stepLabel="Шаг 1 из 6"
          onBack={() => router.push("/settings/integrations")}
          onNext={({ login, connectionId }) => {
            update({
              quickRestoLogin: login,
              quickRestoConnectionId: connectionId,
            });
            setStep(2);
          }}
        />
      ) : null}

      {step === 2 ? (
        <StepQuickRestoBotRole
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          stepLabel="Шаг 2 из 6"
          onBack={() => setStep(1)}
          onNext={({ roleId }) => {
            update({ quickRestoBotRoleExternalId: roleId });
            setStep(3);
          }}
        />
      ) : null}

      {step === 3 ? (
        <StepQuickRestoBotEmployee
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          roleExternalId={state.quickRestoBotRoleExternalId}
          stepLabel="Шаг 3 из 6"
          onBack={() => setStep(2)}
          onNext={({ employeeId, login }) => {
            update({
              quickRestoBotEmployeeExternalId: employeeId,
              quickRestoBackOfficeLogin: login ?? state.quickRestoBackOfficeLogin,
            });
            setStep(4);
          }}
        />
      ) : null}

      {step === 4 ? (
        <StepQuickRestoBackOfficeCredentials
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          initialLogin={state.quickRestoBackOfficeLogin}
          stepLabel="Шаг 4 из 6"
          onBack={() => setStep(3)}
          onNext={({ login }) => {
            update({
              quickRestoBackOfficeLogin: login,
            });
            setStep(5);
          }}
        />
      ) : null}

      {step === 5 ? (
        <StepQuickRestoOptions
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          stepLabel="Шаг 5 из 6"
          importVenues={state.importVenues}
          importRoles={state.importRoles}
          importEmployees={state.importEmployees}
          importStores={state.importStores}
          importIngredientGroups={state.importIngredientGroups}
          importIngredients={state.importIngredients}
          selectedVenueExternalIds={state.selectedVenueExternalIds}
          selectedRoleExternalIds={state.selectedRoleExternalIds}
          selectedEmployeeExternalIds={state.selectedEmployeeExternalIds}
          onUpdate={update}
          onBack={() => setStep(4)}
          onNext={() => setStep(6)}
        />
      ) : null}

      {step === 6 ? (
        <StepQuickRestoImport
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          stepLabel="Шаг 6 из 6"
          importVenues={state.importVenues}
          importRoles={state.importRoles}
          importEmployees={state.importEmployees}
          importStores={state.importStores}
          importIngredientGroups={state.importIngredientGroups}
          importIngredients={state.importIngredients}
          selectedVenueExternalIds={state.selectedVenueExternalIds}
          selectedRoleExternalIds={state.selectedRoleExternalIds}
          selectedEmployeeExternalIds={state.selectedEmployeeExternalIds}
          onBack={() => setStep(5)}
          onDone={() => router.push("/settings/integrations?quickresto=done")}
        />
      ) : null}
    </div>
  );
}
