"use client";

import { createContext, useContext, type ReactNode } from "react";

export type KbCollectionRuntime = {
  pageId: string | null;
  canCreatePages: boolean;
};

const KbCollectionRuntimeContext = createContext<KbCollectionRuntime>({
  pageId: null,
  canCreatePages: false,
});

export function KbCollectionRuntimeProvider({
  value,
  children,
}: {
  value: KbCollectionRuntime;
  children: ReactNode;
}) {
  return (
    <KbCollectionRuntimeContext.Provider value={value}>
      {children}
    </KbCollectionRuntimeContext.Provider>
  );
}

export function useKbCollectionRuntime(): KbCollectionRuntime {
  return useContext(KbCollectionRuntimeContext);
}
