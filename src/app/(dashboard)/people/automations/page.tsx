import { loadAutomationWorkspace } from "./actions";
import { AutomationWorkspace } from "./workspace";
export default async function Page() {
  return <AutomationWorkspace initial={await loadAutomationWorkspace()} />;
}
