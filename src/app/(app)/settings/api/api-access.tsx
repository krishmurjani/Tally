"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { Collapsible } from "@/components/collapsible";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SaveStatus } from "@/components/save-status";
import { useAction } from "@/lib/client/use-action";
import { createApiTokenAction, deleteAliasAction, revokeApiTokenAction } from "@/server/actions/inbox";

interface Token {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never");

const EXAMPLE = `{
  "items": [
    {
      "externalId": "2026-11-16-wholefoods-4f2a",
      "date": "2026-11-16",
      "description": "Whole Foods",
      "amount": "84.37",
      "currency": "USD",
      "category": "Groceries",
      "type": "private"
    },
    {
      "externalId": "2026-11-16-dinner-9c1b",
      "date": "2026-11-16",
      "description": "Dinner",
      "amount": "120.00",
      "category": "Dining Out",
      "type": "shared",
      "group": "Apartment",
      "paidBy": "me",
      "split": [
        { "person": "me", "owes": "40.00" },
        { "person": "Alex", "owes": "80.00" }
      ]
    }
  ]
}`;

function AliasRow({ a }: { a: { id: string; alias: string; displayName: string } }) {
  const del = useAction(deleteAliasAction, { success: "Alias removed" });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span>
        “{a.alias}” <span className="text-muted">means</span> <b>{a.displayName}</b>
      </span>
      <button disabled={del.pending} onClick={() => void del.run({ id: a.id })} className="h-9 rounded-lg border border-line px-3 text-sm transition hover:bg-forest-50 disabled:opacity-60">
        Remove
      </button>
    </li>
  );
}

export function ApiAccess({ tokens, aliases }: { tokens: Token[]; aliases: { id: string; alias: string; displayName: string }[] }) {
  const [name, setName] = useState("Instinct");
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [origin, setOrigin] = useState("https://<your-tally-address>");
  useEffect(() => setOrigin(window.location.origin), []);
  const create = useAction(createApiTokenAction, { success: "Token created — copy it now" });
  const revoke = useAction(revokeApiTokenAction, { success: "Token revoked" });
  const active = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="space-y-6">
      <Card title="Tokens">
        <p className="mb-4 text-sm text-muted">
          A token lets an assistant send expenses to your Inbox. It can&apos;t read your data and can&apos;t approve anything. You see the token <b>once</b>, so put it straight into the assistant&apos;s secure vault, not into a chat.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await create.run({ name });
            if (r?.ok) {
              setFresh({ token: r.data.token, name });
              setCopied(false);
            }
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="h-11 w-56 rounded-xl border border-line bg-surface px-3 outline-none focus:border-forest-600" />
          </label>
          <button type="submit" disabled={create.pending} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-60">
            Create token
          </button>
          <SaveStatus state={create.state.kind === "saved" ? { kind: "idle" } : create.state} />
        </form>

        {fresh && (
          <div role="status" className="mt-4 rounded-xl border border-warn/30 bg-warn-50 p-4">
            <p className="text-sm font-medium text-warn">Copy this token now — it won&apos;t be shown again.</p>
            <code className="mt-2 block break-all rounded-lg bg-surface px-3 py-2 text-sm">{fresh.token}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.token);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => setFresh(null)} className="h-10 rounded-xl px-3 text-sm text-muted transition hover:text-ink">
                I&apos;ve saved it
              </button>
            </div>
          </div>
        )}

        <ul className="mt-5 divide-y divide-line/70 text-sm">
          {tokens.length === 0 && <li className="py-3 text-muted">No tokens yet.</li>}
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {t.name} <span className="font-mono text-xs text-muted">{t.prefix}…</span>
                  {t.revokedAt && <span className="ml-2"><Badge tone="danger">revoked</Badge></span>}
                </p>
                <p className="text-xs text-muted">
                  Created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </p>
              </div>
              {!t.revokedAt && (
                <button onClick={() => setRevoking(t)} className="h-9 rounded-lg border border-danger/30 px-3 text-sm text-danger transition hover:bg-danger-50">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
        {active.length === 0 && tokens.length > 0 && <p className="mt-2 text-xs text-faint">All tokens are revoked, so nothing can send to the Inbox.</p>}
      </Card>

      <Card title="Name aliases">
        <p className="text-sm text-muted">When the assistant uses a name Splitwise doesn&apos;t know (like a full surname), the posting screen asks who it is, once. Those answers are kept here.</p>
        <ul className="mt-3 divide-y divide-line/70 text-sm">
          {aliases.length === 0 && <li className="py-3 text-muted">None yet.</li>}
          {aliases.map((a) => (
            <AliasRow key={a.id} a={a} />
          ))}
        </ul>
      </Card>

      <Card title="How it's used">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>The assistant POSTs a batch to the address below with your token.</li>
          <li>Each expense lands in the Inbox as a draft. Nothing is posted to Splitwise and nothing counts yet.</li>
          <li>You approve them one by one or all at once. Private expenses are added to Tally.</li>
          <li>Resending the same externalId is ignored, so retries are safe.</li>
        </ol>
        <p className="mt-3 text-sm">
          <b>Check without saving:</b> add <code className="rounded bg-canvas px-1">?dryRun=true</code> to the address.
        </p>
        <div className="mt-3">
          <Collapsible title="Address, format and example" meta="for the assistant">
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted">Send expenses: </span>
                <code className="break-all rounded bg-canvas px-1">POST {origin}/api/inbox</code>
              </p>
              <p>
                <span className="text-muted">Category names and limits: </span>
                <code className="break-all rounded bg-canvas px-1">GET {origin}/api/inbox/meta</code>
              </p>
              <p>
                <span className="text-muted">Header: </span>
                <code className="rounded bg-canvas px-1">Authorization: Bearer tly_…</code>
              </p>
              <pre className="overflow-x-auto rounded-xl bg-canvas p-3 text-xs">{EXAMPLE}</pre>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                <li>Amounts are strings with at most two decimals. For shared expenses, the owed amounts must add up to the total exactly.</li>
                <li>Per-item status in the reply: created, duplicate_ignored, invalid (with reasons). With dryRun: would_create, would_ignore_duplicate.</li>
                <li>Up to 100 items per request. Private expenses are tracked in USD; other currencies stay in the Inbox for review.</li>
                <li>An unknown or missing category isn&apos;t guessed: you choose it in the Inbox.</li>
              </ul>
            </div>
          </Collapsible>
        </div>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke “${revoking?.name ?? ""}”?`}
        confirmLabel="Revoke token"
        busy={revoke.pending}
        error={revoke.state.kind === "failed" ? <SaveStatus state={revoke.state} /> : null}
        onCancel={() => {
          setRevoking(null);
          revoke.reset();
        }}
        onConfirm={async () => {
          if (!revoking) return;
          const r = await revoke.run({ id: revoking.id });
          if (r?.ok) setRevoking(null);
        }}
      >
        Anything using this token will be rejected straight away. Items it already sent stay in the Inbox.
      </ConfirmDialog>
    </div>
  );
}
