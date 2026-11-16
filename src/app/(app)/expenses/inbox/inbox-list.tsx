"use client";

import { useEffect, useState } from "react";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Collapsible } from "@/components/collapsible";
import { Drawer } from "@/components/drawer";
import { Select } from "@/components/select";
import { SaveStatus } from "@/components/save-status";
import { shortDate } from "@/engines/dates";
import { formatUSD } from "@/engines/money";
import { useAction } from "@/lib/client/use-action";
import { approveInboxAction, approveReadyAction, checkPostingAction, postToSplitwiseAction, previewSplitwisePostsAction, rejectInboxAction, setInboxCategoryAction } from "@/server/actions/inbox";
import type { PostPreview } from "@/server/repos/inbox-post";

interface Row {
  id: string;
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  kind: "private" | "shared";
  categoryId: string | null;
  categoryName: string | null;
  groupName: string | null;
  paidBy: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "posting";
  blockers: string[];
  split: { person: string; owesMinor: number }[] | null;
  splitwiseExpenseId: number | null;
  postError: string | null;
}

const money = (r: { amountMinor: number; currency: string }) => (r.currency === "USD" ? formatUSD(r.amountMinor) : `${r.currency} ${(r.amountMinor / 100).toFixed(2)}`);

/** The confirmation: exactly what will be created in Splitwise, and nothing happens until the button is pressed. */
function PostDrawer({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [previews, setPreviews] = useState<PostPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const post = useAction(postToSplitwiseAction, { success: false });
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreviews(null);
    setError(null);
    setOutcome(null);
    previewSplitwisePostsAction({ ids })
      .then((r) => {
        if (!live) return;
        if (r.ok) setPreviews(r.data);
        else setError(r.message);
      })
      .catch(() => live && setError("Couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [ids]);

  const allOk = previews !== null && previews.length > 0 && previews.every((p) => p.ok);
  return (
    <Drawer open onClose={onClose} title={ids.length === 1 ? "Post to Splitwise" : `Post ${ids.length} to Splitwise`} subtitle="Check this carefully. It creates the expense in Splitwise, and the people in it will see it.">
      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!previews && !error && <p className="text-sm text-muted">Looking up your groups in Splitwise…</p>}
      {previews && previews.length === 0 && <p className="text-sm text-muted">Nothing here can be posted any more. Close this and refresh.</p>}
      <ul className="space-y-4">
        {previews?.map((p) => (
          <li key={p.id} className={`rounded-xl border p-4 ${p.ok ? "border-line bg-surface" : "border-warn/30 bg-warn-50"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{p.description}</p>
              <p className="font-semibold tabular-nums">{money(p)}</p>
            </div>
            <p className="text-sm text-muted">
              {shortDate(p.date)} · {p.plan ? (p.plan.groupName ? `Group: ${p.plan.groupName}` : "No group (between friends)") : "Group not found"}
            </p>
            {p.plan && (
              <ul className="mt-2 space-y-0.5 text-sm">
                {p.plan.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {p.problems.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-warn">
                {p.problems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {outcome && (
        <p role="status" className="mt-4 rounded-xl border border-line bg-canvas px-3 py-2 text-sm">
          {outcome}
        </p>
      )}
      {previews && previews.length > 0 && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={!allOk || post.pending || outcome !== null}
              onClick={async () => {
                const r = await post.run({ ids: previews.map((p) => p.id) });
                if (r?.ok) {
                  setOutcome(r.data.stoppedBecause ? `Posted ${r.data.posted}. Stopped: ${r.data.stoppedBecause}` : `Posted ${r.data.posted} to Splitwise. They'll appear in your expenses after the next sync.`);
                }
              }}
              className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50"
            >
              {post.pending ? "Posting…" : `Post ${previews.length === 1 ? "to Splitwise" : `${previews.length} to Splitwise`}`}
            </button>
            <button onClick={onClose} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
              {outcome ? "Close" : "Cancel"}
            </button>
            <SaveStatus state={post.state.kind === "saved" ? { kind: "idle" } : post.state} />
          </div>
          {!allOk && <p className="text-xs text-muted">Fix what's flagged above first. Nothing will be posted while anything is flagged.</p>}
        </div>
      )}
    </Drawer>
  );
}

function PendingRow({ r, categories, onPost }: { r: Row; categories: { id: string; name: string }[]; onPost: (id: string) => void }) {
  const approve = useAction(approveInboxAction, { success: "Approved — it's in your expenses" });
  const reject = useAction(rejectInboxAction, { success: "Rejected" });
  const setCat = useAction(setInboxCategoryAction, { success: false });
  const busy = approve.pending || reject.pending || setCat.pending;
  const shared = r.kind === "shared";
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="break-words font-medium">{r.description}</p>
          <p className="text-sm text-muted">
            {shortDate(r.date)}
            {shared && ` · Shared${r.groupName ? ` · ${r.groupName}` : ""}`}
            {r.note ? ` · ${r.note}` : ""}
          </p>
        </div>
        <p className="text-lg font-semibold tabular-nums">{money(r)}</p>
      </div>
      {shared && r.split && (
        <p className="text-xs text-muted">
          {r.paidBy ? `${r.paidBy} paid · ` : ""}
          {r.split.map((s) => `${s.person} ${(s.owesMinor / 100).toFixed(2)}`).join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel={`Category for ${r.description}`}
          value={r.categoryId ?? ""}
          onChange={(v) => v && void setCat.run({ id: r.id, categoryId: v })}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={r.categoryName ? `Pick for “${r.categoryName}”` : "Choose category"}
          className="w-full min-w-44 sm:w-56"
        />
        {shared ? (
          <button disabled={busy || r.blockers.length > 0} onClick={() => onPost(r.id)} className="h-11 flex-1 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50 sm:flex-none">
            Review &amp; post
          </button>
        ) : (
          <button disabled={busy || r.blockers.length > 0} onClick={() => void approve.run({ id: r.id })} className="h-11 flex-1 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50 sm:flex-none">
            Approve
          </button>
        )}
        <button disabled={busy} onClick={() => void reject.run({ id: r.id })} className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
          Reject
        </button>
      </div>
      {r.blockers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.blockers.map((b) => (
            <Badge key={b} tone="warn">
              {b}
            </Badge>
          ))}
        </div>
      )}
      {r.postError && <p className="text-sm text-danger">Last attempt: {r.postError}</p>}
      <SaveStatus state={approve.state.kind === "saved" ? { kind: "idle" } : approve.state} />
      <SaveStatus state={reject.state.kind === "saved" ? { kind: "idle" } : reject.state} />
      <SaveStatus state={setCat.state.kind === "saved" ? { kind: "idle" } : setCat.state} />
    </li>
  );
}

/** A post that never got a clear answer from Splitwise: look for it there before anything else. */
function PostingRow({ r }: { r: Row }) {
  const check = useAction(checkPostingAction, {
    success: (d) => (d.result === "linked" ? "Found it in Splitwise — linked" : d.result === "not_found" ? "Not in Splitwise — safe to post again" : "More than one match — check Splitwise"),
  });
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{r.description}</p>
          <p className="text-sm text-muted">
            {shortDate(r.date)}
            {r.groupName ? ` · ${r.groupName}` : ""}
          </p>
        </div>
        <p className="font-semibold tabular-nums">{money(r)}</p>
      </div>
      <p className="text-sm text-warn">{r.postError ?? "A post to Splitwise started but wasn't confirmed."}</p>
      <button disabled={check.pending} onClick={() => void check.run({ id: r.id })} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50 disabled:opacity-60">
        Check Splitwise
      </button>
      <SaveStatus state={check.state.kind === "saved" ? { kind: "idle" } : check.state} />
    </li>
  );
}

export function InboxList({ pending, posting, recent, categories }: { pending: Row[]; posting: Row[]; recent: Row[]; categories: { id: string; name: string }[] }) {
  const all = useAction(approveReadyAction, { success: (d) => `Approved ${d.approved}${d.left ? ` · ${d.left} still need you` : ""}` });
  const [postIds, setPostIds] = useState<string[] | null>(null);
  const readyPrivate = pending.filter((r) => r.kind === "private" && r.blockers.length === 0).length;
  const readyShared = pending.filter((r) => r.kind === "shared" && r.blockers.length === 0).map((r) => r.id);
  return (
    <div className="space-y-6">
      {posting.length > 0 && (
        <Card title={`Needs a check · ${posting.length}`}>
          <ul className="divide-y divide-line/70">
            {posting.map((r) => (
              <PostingRow key={r.id} r={r} />
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={`Waiting for you · ${pending.length}`}
        action={
          pending.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {readyShared.length > 0 && (
                <button onClick={() => setPostIds(readyShared.slice(0, 25))} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
                  Review &amp; post shared ({readyShared.length})
                </button>
              )}
              <button disabled={all.pending || readyPrivate === 0} onClick={() => void all.run(undefined as never)} className="h-10 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-50">
                Approve all ready ({readyPrivate})
              </button>
            </div>
          ) : undefined
        }
      >
        {pending.length === 0 ? (
          <EmptyState title="Nothing waiting">New expenses sent through the API show up here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/70">
            {pending.map((r) => (
              <PendingRow key={r.id} r={r} categories={categories} onPost={(id) => setPostIds([id])} />
            ))}
          </ul>
        )}
        <SaveStatus state={all.state.kind === "saved" ? { kind: "idle" } : all.state} />
      </Card>

      {recent.length > 0 && (
        <Collapsible title="Recently decided" meta={`${recent.length}`}>
          <ul className="divide-y divide-line/70 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.description}</span> <span className="text-muted">· {shortDate(r.date)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(r)}</span>
                  <Badge tone={r.status === "approved" ? "forest" : "neutral"}>{r.splitwiseExpenseId ? "posted to Splitwise" : r.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {postIds && <PostDrawer ids={postIds} onClose={() => setPostIds(null)} />}
    </div>
  );
}
