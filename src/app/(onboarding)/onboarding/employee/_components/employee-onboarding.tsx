"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StepSetPassword } from "../../_components/step-set-password";
import { StepProfile, type ProfileInitialData } from "../../_components/step-profile";

interface Props {
  initialProfile: ProfileInitialData;
  isNewUser: boolean;
}

/**
 * Employee onboarding wizard.
 *
 * isNewUser = true  → step 0: SetPassword → step 1: Profile → /dashboard
 * isNewUser = false → step 1: Profile only → /dashboard
 */
export function EmployeeOnboarding({ initialProfile, isNewUser }: Props) {
  const router = useRouter();

  // For new users we start at step 0 (password), for existing — step 1 (profile).
  const [step, setStep] = useState<0 | 1>(isNewUser ? 0 : 1);

  const totalSteps = isNewUser ? 2 : 1;
  const displayStep = isNewUser ? step + 1 : 1;

  const STEP_LABELS = isNewUser
    ? ["Пароль", "Профиль"]
    : ["Профиль"];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="font-semibold text-sm">Добро пожаловать!</span>
          <span className="text-sm text-muted-foreground">
            Шаг {displayStep} из {totalSteps}
          </span>
        </div>
      </div>

      {/* Step indicator */}
      <div className="border-b bg-background">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              // For new users: displayStep = step+1; for existing: always 1
              const isDone = displayStep > n;
              const isActive = displayStep === n;
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
                  {i < STEP_LABELS.length - 1 && (
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
          {step === 0 && (
            <StepSetPassword onNext={() => setStep(1)} />
          )}
          {step === 1 && (
            <StepProfile
              initial={initialProfile}
              onNext={() => router.push("/dashboard")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
