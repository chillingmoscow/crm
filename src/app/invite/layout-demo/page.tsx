import { LayoutDemoClient } from "./_components/layout-demo-client";
import { getDemoHallLayout, getDemoHalls } from "./actions";

export default async function LayoutDemoPage() {
  const halls = await getDemoHalls();
  const initialHallId = halls[0]?.id ?? null;
  const initialLayout = initialHallId
    ? await getDemoHallLayout(initialHallId)
    : null;

  return (
    <LayoutDemoClient
      initialHalls={halls}
      initialHallId={initialHallId}
      initialLayout={initialLayout}
    />
  );
}
