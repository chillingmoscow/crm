import { integrationPageScope } from "@/lib/integrations/settings";
import { readTildaConnection } from "../actions";
import { TildaSettings } from "./tilda-settings";
export default async function TildaPage() {
  const scope = await integrationPageScope();
  return <TildaSettings key={scope.accountId} initial={await readTildaConnection()} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""} />;
}
