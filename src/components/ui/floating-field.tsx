"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

export type FloatingFieldProps = {
  id:            string;
  label:         string;
  placeholder?:  string;
  icon:          React.ReactNode;
  type?:         string;
  inputMode?:    React.HTMLAttributes<HTMLInputElement>["inputMode"];
  error?:        string;
  registration?: UseFormRegisterReturn;
  value?:        string;
  onChange?:     React.ChangeEventHandler<HTMLInputElement>;
  rightSlot?:    React.ReactNode;
  autoComplete?: string;
};

export function FloatingField({
  id,
  label,
  placeholder,
  icon,
  type = "text",
  inputMode,
  error,
  registration,
  value,
  onChange,
  rightSlot,
  autoComplete,
}: FloatingFieldProps) {
  const [focused,  setFocused]  = useState(false);
  const [hasValue, setHasValue] = useState(value !== undefined ? !!value : false);

  // For controlled mode, derive float state from prop directly
  const floated = focused || (value !== undefined ? !!value : hasValue);

  // Split registration into parts
  let rhfBlur:   UseFormRegisterReturn["onBlur"]   | undefined;
  let rhfChange: UseFormRegisterReturn["onChange"] | undefined;
  let rhfRest:   Omit<UseFormRegisterReturn, "onBlur" | "onChange"> | undefined;
  if (registration) {
    const { onBlur, onChange: rhfOnChange, ...rest } = registration;
    rhfBlur   = onBlur;
    rhfChange = rhfOnChange;
    rhfRest   = rest;
  }

  return (
    <div className="space-y-1">
      <div
        className={[
          "relative flex items-center border rounded-xl bg-white h-12 transition-colors duration-150",
          error
            ? "border-red-400"
            : focused
            ? "border-blue-500 ring-2 ring-blue-100"
            : "border-gray-200 hover:border-gray-300",
        ].join(" ")}
      >
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10">
          {icon}
        </span>

        <label
          htmlFor={id}
          className={[
            "absolute pointer-events-none select-none transition-all duration-150 leading-none",
            floated
              ? `top-0 -translate-y-1/2 left-3.5 text-[11px] font-medium px-1 bg-white z-10 ${
                  focused ? "text-blue-500" : "text-gray-400"
                }`
              : "top-1/2 -translate-y-1/2 left-10 text-sm text-gray-400",
          ].join(" ")}
        >
          {label}
        </label>

        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          value={value}
          placeholder={focused ? (placeholder ?? "") : ""}
          className={`absolute inset-0 w-full h-full bg-transparent pl-10 ${
            rightSlot ? "pr-10" : "pr-4"
          } text-sm text-gray-900 outline-none rounded-xl`}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            if (value === undefined) setHasValue(!!e.target.value);
            rhfBlur?.(e);
          }}
          onChange={(e) => {
            if (value === undefined) setHasValue(!!e.target.value);
            rhfChange?.(e);
            onChange?.(e);
          }}
          onAnimationStart={(e) => {
            if (e.animationName === "autoFillStart") setHasValue(true);
          }}
          {...(rhfRest ?? {})}
        />

        {rightSlot && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 z-10">
            {rightSlot}
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
    </div>
  );
}
