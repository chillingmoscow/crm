"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepQuickRestoCredentials } from "@/app/(onboarding)/onboarding/_components/step-quickresto-credentials";
import { StepQuickRestoImport } from "@/app/(onboarding)/onboarding/_components/step-quickresto-import";
import { StepQuickRestoOptions } from "@/app/(onboarding)/onboarding/_components/step-quickresto-options";

interface Props {
  accountId: string;
  initialLogin: string;
  initialConnectionId: string | null;
}

type QuickRestoState = {
  quickRestoLogin: string;
  quickRestoConnectionId: string | null;
  importVenues: boolean;
  importRoles: boolean;
  importEmployees: boolean;
  selectedVenueExternalIds: number[];
  selectedRoleExternalIds: number[];
  selectedEmployeeExternalIds: number[];
};

const INITIAL_STATE: QuickRestoState = {
  quickRestoLogin: "",
  quickRestoConnectionId: null,
  importVenues: true,
  importRoles: true,
  importEmployees: true,
  selectedVenueExternalIds: [],
  selectedRoleExternalIds: [],
  selectedEmployeeExternalIds: [],
};

export function QuickRestoIntegrationFlow({
  accountId,
  initialLogin,
  initialConnectionId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<QuickRestoState>({
    ...INITIAL_STATE,
    quickRestoLogin: initialLogin,
    quickRestoConnectionId: initialConnectionId,
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
          stepLabel="Шаг 1 из 3"
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
        <StepQuickRestoOptions
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          stepLabel="Шаг 2 из 3"
          importVenues={state.importVenues}
          importRoles={state.importRoles}
          importEmployees={state.importEmployees}
          selectedVenueExternalIds={state.selectedVenueExternalIds}
          selectedRoleExternalIds={state.selectedRoleExternalIds}
          selectedEmployeeExternalIds={state.selectedEmployeeExternalIds}
          onUpdate={update}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      ) : null}

      {step === 3 ? (
        <StepQuickRestoImport
          accountId={accountId}
          connectionId={state.quickRestoConnectionId}
          stepLabel="Шаг 3 из 3"
          importVenues={state.importVenues}
          importRoles={state.importRoles}
          importEmployees={state.importEmployees}
          selectedVenueExternalIds={state.selectedVenueExternalIds}
          selectedRoleExternalIds={state.selectedRoleExternalIds}
          selectedEmployeeExternalIds={state.selectedEmployeeExternalIds}
          onBack={() => setStep(2)}
          onDone={() => router.push("/settings/integrations?quickresto=done")}
        />
      ) : null}
    </div>
  );
}
