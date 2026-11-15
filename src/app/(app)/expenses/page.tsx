import { redirect } from "next/navigation";
import { currentMonthNY } from "@/engines/dates";
import { requireOwnerOrRedirect } from "@/server/auth-guard";

export default async function ExpensesIndex() {
  await requireOwnerOrRedirect();
  redirect(`/expenses/${currentMonthNY()}`);
}
