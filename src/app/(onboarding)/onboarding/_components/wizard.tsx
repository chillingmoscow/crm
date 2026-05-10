"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { StepProfile, type ProfileInitialData } from "./step-profile";
import { StepImportMode } from "./step-import-mode";
import { StepAccount } from "./step-account";
import { StepVenue } from "./step-venue";
import { StepStaff } from "./step-staff";
import { StepDone } from "./step-done";
import { StepQuickRestoBackOfficeCredentials } from "./step-quickresto-backoffice-credentials";
import { StepQuickRestoBotEmployee } from "./step-quickresto-bot-employee";
import { StepQuickRestoBotRole } from "./step-quickresto-bot-role";
import { StepQuickRestoCredentials } from "./step-quickresto-credentials";
import { StepQuickRestoOptions } from "./step-quickresto-options";
import { StepQuickRestoImport } from "./step-quickresto-import";
import { createAccountOnly } from "../actions";
import type { VenueType, WorkingHours } from "@/types/database";

export interface WizardData {
  mode: "manual" | "quickresto" | null;
  accountId: string | null;

  accountName: string;
  accountLogoUrl: string | null;

  // Legal entity fields collected on the Account step. Used by
  // createAccountAndVenue → complete_owner_onboarding RPC. If left
  // empty, the RPC falls back to legal_form='IP' / name=accountName
  // and the owner can edit the entity later from /org/legal-entities.
  legalName: string;
  legalForm: "IP" | "OOO" | "AO" | "PAO" | "NKO" | "OTHER";
  legalInn: string;

  venueName: string;
  venueType: VenueType;
  venueAddress: string;
  venuePhone: string;
  venueWebsite: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
  venueId: string | null;

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
}

const INITIAL_WORKING_HOURS: WorkingHours = {
  mon: { open: "10:00", close: "22:00", closed: false },
  tue: { open: "10:00", close: "22:00", closed: false },
  wed: { open: "10:00", close: "22:00", closed: false },
  thu: { open: "10:00", close: "22:00", closed: false },
  fri: { open: "10:00", close: "23:00", closed: false },
  sat: { open: "11:00", close: "23:00", closed: false },
  sun: { open: "11:00", close: "22:00", closed: false },
};

const INITIAL_DATA: WizardData = {
  mode: null,
  accountId: null,

  accountName: "",
  accountLogoUrl: null,

  legalName: "",
  legalForm: "OOO",
  legalInn: "",

  venueName: "",
  venueType: "restaurant",
  venueAddress: "",
  venuePhone: "",
  venueWebsite: "",
  currency: "RUB",
  timezone: "Europe/Moscow",
  workingHours: INITIAL_WORKING_HOURS,
  venueId: null,

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

function getStorageKey(userId: string) {
  return `onboarding_wizard_v2_${userId}`;
}

function loadFromStorage(storageKey: string): { step: number; data: WizardData } {
  if (typeof window === "undefined") return { step: 1, data: INITIAL_DATA };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { step: 1, data: INITIAL_DATA };
    const parsed = JSON.parse(raw) as { step?: number; data?: WizardData };
    return {
      step: parsed.step ?? 1,
      data: { ...INITIAL_DATA, ...(parsed.data ?? {}) },
    };
  } catch {
    return { step: 1, data: INITIAL_DATA };
  }
}

interface Props {
  userId: string;
  roles: { id: string; name: string; code: string }[];
  initialProfile: ProfileInitialData;
  initialAccount: { id: string | null; name: string; logoUrl: string | null };
  startQuickRestoFlow?: boolean;
  /** Hides the «Из DaData» button on the legal-entity step when DaData isn't configured. */
  dadataEnabled?: boolean;
}

export function OnboardingWizard({
  userId,
  roles,
  initialProfile,
  initialAccount,
  startQuickRestoFlow = false,
  dadataEnabled = true,
}: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [hydrated, setHydrated] = useState(false);
  const [savedProfile, setSavedProfile] = useState<ProfileInitialData | null>(null);
  const storageKey = getStorageKey(userId);

  useEffect(() => {
    const saved = loadFromStorage(storageKey);
    const safeStep = saved.step <= 10 ? saved.step : 1;
    const preparedData = {
      ...saved.data,
      accountId: initialAccount.id ?? null,
      accountName: initialAccount.name || saved.data.accountName,
      accountLogoUrl: initialAccount.logoUrl ?? saved.data.accountLogoUrl,
    };

    if (startQuickRestoFlow && initialAccount.id) {
      setStep(4);
      setData({
        ...preparedData,
        mode: "quickresto",
      });
      setHydrated(true);
      return;
    }

    setStep(safeStep);
    setData(preparedData);
    setHydrated(true);
  }, [initialAccount.id, initialAccount.logoUrl, initialAccount.name, startQuickRestoFlow, storageKey]);

  const saveToStorage = useCallback((nextStep: number, nextData: WizardData) => {
    if (typeof window === "undefined") return;
    const finishStep = nextData.mode === "quickresto" ? 10 : 6;
    if (nextStep >= finishStep) {
      localStorage.removeItem(storageKey);
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ step: nextStep, data: nextData }));
    } catch {
      // ignore localStorage failures
    }
  }, [storageKey]);

  const update = useCallback((patch: Partial<WizardData>) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      saveToStorage(step, next);
      return next;
    });
  }, [saveToStorage, step]);

  const goTo = useCallback((nextStep: number, patch?: Partial<WizardData>) => {
    setData((prev) => {
      const next = patch ? { ...prev, ...patch } : prev;
      saveToStorage(nextStep, next);
      return next;
    });
    setStep(nextStep);
  }, [saveToStorage]);

  const totalSteps = data.mode === "quickresto" ? 10 : 6;
  const progressPct = Math.round((step / totalSteps) * 100);

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-[560px] mx-auto px-6 h-16 flex items-center justify-between">
          <Image src="/logo-full.svg" alt="Sheerly" width={100} height={24} priority />
          <span className="text-sm text-gray-400 tabular-nums">
            {step}&thinsp;/&thinsp;{totalSteps}
          </span>
        </div>
      </header>

      <div className="h-0.5 bg-gray-100 shrink-0">
        <div className="h-0.5 bg-blue-600 transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
      </div>

      <main className="flex-1 flex items-start justify-center p-4 pt-10 pb-16">
        <div className="w-full max-w-[520px]">
          {step === 1 && (
            <StepAccount
              data={data}
              onUpdate={update}
              onBack={() => {}}
              stepLabel={`Шаг 1 из ${totalSteps}`}
              hideBack
              onNext={() => goTo(2)}
              dadataEnabled={dadataEnabled}
            />
          )}

          {step === 2 && (
            <StepProfile
              initial={savedProfile ?? initialProfile}
              stepLabel={`Шаг 2 из ${totalSteps}`}
              onNext={() => goTo(3)}
              onSaved={(p) => setSavedProfile(p)}
            />
          )}

          {step === 3 && (
            <StepImportMode
              stepLabel={`Шаг 3 из ${totalSteps}`}
              onSelect={async (mode) => {
                if (mode === "quickresto") {
                  if (data.accountId) {
                    goTo(4, {
                      mode,
                      venueId: null,
                      quickRestoConnectionId: null,
                      quickRestoBackOfficeLogin: "",
                      quickRestoBotRoleExternalId: null,
                      quickRestoBotEmployeeExternalId: null,
                      selectedVenueExternalIds: [],
                      selectedRoleExternalIds: [],
                      selectedEmployeeExternalIds: [],
                    });
                    return;
                  }

                  const result = await createAccountOnly({
                    accountName: data.accountName,
                    accountLogoUrl: data.accountLogoUrl,
                  });

                  if (result.error || !result.accountId) {
                    toast.error(result.error ?? "Не удалось создать аккаунт");
                    return;
                  }

                  goTo(4, {
                    mode,
                    accountId: result.accountId,
                    venueId: null,
                    quickRestoConnectionId: null,
                    quickRestoBackOfficeLogin: "",
                    quickRestoBotRoleExternalId: null,
                    quickRestoBotEmployeeExternalId: null,
                    selectedVenueExternalIds: [],
                    selectedRoleExternalIds: [],
                    selectedEmployeeExternalIds: [],
                  });
                  return;
                }

                goTo(4, {
                  mode,
                  venueId: null,
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                });
              }}
            />
          )}

          {step === 4 && data.mode !== "quickresto" && (
            <StepVenue
              data={data}
              stepLabel={`Шаг 4 из ${totalSteps}`}
              onUpdate={update}
              onNext={(venueId) => goTo(5, { venueId })}
              onBack={() => goTo(3)}
            />
          )}

          {step === 5 && data.mode !== "quickresto" && (
            <StepStaff
              venueId={data.venueId!}
              roles={roles}
              stepLabel={`Шаг 5 из ${totalSteps}`}
              onNext={() => goTo(6)}
              onSkip={() => goTo(6)}
            />
          )}

          {step === 6 && data.mode !== "quickresto" && <StepDone />}

          {step === 4 && data.mode === "quickresto" && (
            <StepQuickRestoCredentials
              accountId={data.accountId}
              initialLogin={data.quickRestoLogin}
              stepLabel={`Шаг 4 из ${totalSteps}`}
              onBack={() => goTo(3)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onNext={({ login, connectionId }) =>
                goTo(5, {
                  quickRestoLogin: login,
                  quickRestoConnectionId: connectionId,
                })
              }
            />
          )}

          {step === 5 && data.mode === "quickresto" && (
            <StepQuickRestoBotRole
              accountId={data.accountId}
              connectionId={data.quickRestoConnectionId}
              stepLabel={`Шаг 5 из ${totalSteps}`}
              onBack={() => goTo(4)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onNext={({ roleId }) => goTo(6, { quickRestoBotRoleExternalId: roleId })}
            />
          )}

          {step === 6 && data.mode === "quickresto" && (
            <StepQuickRestoBotEmployee
              accountId={data.accountId}
              connectionId={data.quickRestoConnectionId}
              roleExternalId={data.quickRestoBotRoleExternalId}
              stepLabel={`Шаг 6 из ${totalSteps}`}
              onBack={() => goTo(5)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onNext={({ employeeId, login }) =>
                goTo(7, {
                  quickRestoBotEmployeeExternalId: employeeId,
                  quickRestoBackOfficeLogin: login ?? data.quickRestoBackOfficeLogin,
                })
              }
            />
          )}

          {step === 7 && data.mode === "quickresto" && (
            <StepQuickRestoBackOfficeCredentials
              accountId={data.accountId}
              connectionId={data.quickRestoConnectionId}
              initialLogin={data.quickRestoBackOfficeLogin}
              stepLabel={`Шаг 7 из ${totalSteps}`}
              onBack={() => goTo(6)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onNext={({ login }) =>
                goTo(8, {
                  quickRestoBackOfficeLogin: login,
                })
              }
            />
          )}

          {step === 8 && data.mode === "quickresto" && (
            <StepQuickRestoOptions
              accountId={data.accountId}
              connectionId={data.quickRestoConnectionId}
              stepLabel={`Шаг 8 из ${totalSteps}`}
              importVenues={data.importVenues}
              importRoles={data.importRoles}
              importEmployees={data.importEmployees}
              importStores={data.importStores}
              importIngredientGroups={data.importIngredientGroups}
              importIngredients={data.importIngredients}
              selectedVenueExternalIds={data.selectedVenueExternalIds}
              selectedRoleExternalIds={data.selectedRoleExternalIds}
              selectedEmployeeExternalIds={data.selectedEmployeeExternalIds}
              onUpdate={update}
              onBack={() => goTo(7)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onNext={() => goTo(9)}
            />
          )}

          {step === 9 && data.mode === "quickresto" && (
            <StepQuickRestoImport
              accountId={data.accountId}
              connectionId={data.quickRestoConnectionId}
              stepLabel={`Шаг 9 из ${totalSteps}`}
              importVenues={data.importVenues}
              importRoles={data.importRoles}
              importEmployees={data.importEmployees}
              importStores={data.importStores}
              importIngredientGroups={data.importIngredientGroups}
              importIngredients={data.importIngredients}
              selectedVenueExternalIds={data.selectedVenueExternalIds}
              selectedRoleExternalIds={data.selectedRoleExternalIds}
              selectedEmployeeExternalIds={data.selectedEmployeeExternalIds}
              onBack={() => goTo(8)}
              onSkipIntegration={() =>
                goTo(4, {
                  mode: "manual",
                  quickRestoConnectionId: null,
                  quickRestoBackOfficeLogin: "",
                  quickRestoBotRoleExternalId: null,
                  quickRestoBotEmployeeExternalId: null,
                  selectedVenueExternalIds: [],
                  selectedRoleExternalIds: [],
                  selectedEmployeeExternalIds: [],
                  importStores: false,
                  importIngredientGroups: false,
                  importIngredients: false,
                })
              }
              onDone={(payload) => {
                if (payload?.needsVenueSetup) {
                  goTo(4, {
                    mode: "manual",
                    importVenues: false,
                    importRoles: false,
                    importEmployees: false,
                  });
                  return;
                }
                goTo(10);
              }}
            />
          )}

          {step === 10 && data.mode === "quickresto" && <StepDone />}
        </div>
      </main>
    </div>
  );
}
