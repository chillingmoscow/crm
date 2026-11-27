import { loadShiftNow, type ShiftNow } from "@/lib/home/shift-now";

import { BlockError, HomeSection } from "./section";
import { ShiftNowCard } from "./shift-now-card";

/** Серверная часть «Смены сейчас»: первая загрузка, дальше обновляет карточка. */
export async function ShiftNowBlock({ canOpenStaff }: { canOpenStaff: boolean }) {
  let data: ShiftNow | null;
  try {
    data = await loadShiftNow();
  } catch (error) {
    console.error("[home] shift now:", error);
    return (
      <HomeSection title="Смена сейчас">
        <BlockError what="смену" />
      </HomeSection>
    );
  }
  if (!data) return null;
  return <ShiftNowCard initial={data} canOpenStaff={canOpenStaff} />;
}
