import { loadPayroll } from "../../people/payroll/actions";
import { AttendanceClient } from "./attendance-client";
export default async function AttendancePage() {
  return <AttendanceClient initial={await loadPayroll()} />;
}
