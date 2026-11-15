"use client";

import { useState } from "react";
import { SaveStatus } from "@/components/save-status";
import { useAction } from "@/lib/client/use-action";
import { createCategoryAction } from "@/server/actions/budgets";

export function CategoriesForm({ categories }: { categories: { id: string; name: string; kind: string }[] }) {
  const [name, setName] = useState("");
  const a = useAction(createCategoryAction, { success: "Category added" });
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-2 text-sm">
        {categories.map((c) => (
          <li key={c.id} className={`rounded-full border px-3 py-1 ${c.kind === "custom" ? "border-forest-100 bg-forest-50 text-forest-800" : "border-line"}`}>
            {c.name}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run({ name });
          if (r?.ok) setName("");
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New category, e.g. Trip - Miami" aria-label="New category name" className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3 sm:max-w-72" />
        <button type="submit" disabled={a.pending || !name.trim()} className="h-11 rounded-xl bg-forest-700 px-4 text-sm font-medium text-white disabled:opacity-60">
          Add category
        </button>
        <SaveStatus state={a.state} />
      </form>
    </div>
  );
}
