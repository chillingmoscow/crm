"use client";

import { useState } from "react";
import { StepAccount } from "./step-account";
import { StepVenue } from "./step-venue";
import { StepStaff } from "./step-staff";
import { StepDone } from "./step-done";
import type { VenueType, WorkingHours } from "@/types/database";

export interface WizardData {
  // Step 1
  accountName: string;
  accountLogoUrl: string | null;
  // Step 2
  venueName: string;
  venueType: VenueType;
  venueAddress: string;
  venuePhone: string;
  currency: string;
  timezone: string;
  workingHours: WorkingHours;
  // Step 3 — venueId needed after creation
  venueId: string | null;
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

interface Props {
  roles: { id: string; name: string; code: string }[];
}

export function OnboardingWizard({ roles }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>({
    accountName: "",
    accountLogoUrl: null,
    venueName: "",
    venueType: "restaurant",
    venueAddress: "",
    venuePhone: "",
    currency: "RUB",
    timezone: "Europe/Moscow",
    workingHours: INITIAL_WORKING_HOURS,
    venueId: null,
  });

  const update = (patch: Partial<WizardData>) =>
    setData((prev) => ({ ...prev, ...patch }));

  const STEPS = ["Аккаунт", "Заведение", "Сотрудники", "Готово"];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="font-semibold text-sm">Настройка платформы</span>
          <span className="text-sm text-muted-foreground">
            Шаг {step} из {STEPS.length}
          </span>
        </div>
      </div>

      {/* Step indicator */}
      <div className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const isDone = step > n;
              const isActive = step === n;
              return (
                <div key={n} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                        isDone
                          ? "bg-primary text-primary-foreground"
                          : isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isDone ? "✓" : n}
                    </div>
                    <span
                      className={`text-sm hidden sm:block ${
                        isActive ? "font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`h-px flex-1 w-8 ${
                        isDone ? "bg-primary" : "bg-border"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center p-4 pt-8">
        <div className="w-full max-w-2xl">
          {step === 1 && (
            <StepAccount
              data={data}
              onUpdate={update}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepVenue
              data={data}
              onUpdate={update}
              onNext={(venueId) => {
                update({ venueId });
                setStep(3);
              }}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <StepStaff
              venueId={data.venueId!}
              roles={roles}
              onNext={() => setStep(4)}
              onSkip={() => setStep(4)}
            />
          )}
          {step === 4 && <StepDone />}
        </div>
      </div>
    </div>
  );
}
