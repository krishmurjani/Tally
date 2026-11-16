import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerOrRedirect } from "@/server/auth-guard";
import { getDb } from "@/server/db/client";
import { loadInbox } from "@/server/repos/inbox";
import { InboxList } from "./inbox-list";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const owner = await requireOwnerOrRedirect();
  const { pending, recent, categories } = await loadInbox(getDb(), owner);
  const view = (r: (typeof pending)[number]) => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amountMinor: r.amountMinor,
    currency: r.currency,
    kind: r.kind,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    groupName: r.groupName,
    paidBy: r.paidBy,
    note: r.note,
    status: r.status,
    blockers: r.blockers,
    split: r.split,
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <Link href="/settings/api" className="text-sm font-medium text-brand hover:underline">
          API access →
        </Link>
      </div>
      <p className="text-sm text-muted">Expenses sent by an assistant wait here. Nothing counts toward your budget until you approve it.</p>
      <InboxList pending={pending.map(view)} recent={recent.map(view)} categories={categories} />
    </div>
  );
}
