"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, type Category } from "@/domain/categories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AddTransactionFormPrefill {
  merchant?: string;
  amount?: number;
  type?: "income" | "expense";
  category?: Category;
}

export interface AddTransactionFormProps {
  open: boolean;
  prefill: AddTransactionFormPrefill;
  onClose: () => void;
  onSaved: () => void;
}

export const AddTransactionForm = ({
  open,
  prefill,
  onClose,
  onSaved,
}: AddTransactionFormProps) => {
  const [merchant, setMerchant] = useState(prefill.merchant ?? "");
  const [amount, setAmount] = useState(
    prefill.amount !== undefined ? String(prefill.amount) : "",
  );
  const [type, setType] = useState<"income" | "expense">(
    prefill.type ?? "expense",
  );
  const [category, setCategory] = useState<Category>(
    prefill.category ?? "Other",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMerchant(prefill.merchant ?? "");
    setAmount(prefill.amount !== undefined ? String(prefill.amount) : "");
    setType(prefill.type ?? "expense");
    setCategory(prefill.category ?? "Other");
  }, [prefill]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant,
          amount: Number(amount),
          type,
          ...(type === "expense" ? { category } : {}),
        }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Add transaction</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Merchant"
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            required
          />
          <input
            type="number"
            step="0.01"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            placeholder="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant={type === "expense" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setType("expense")}
            >
              Expense
            </Button>
            <Button
              type="button"
              variant={type === "income" ? "default" : "ghost"}
              className="flex-1"
              onClick={() => setType("income")}
            >
              Income
            </Button>
          </div>
          {type === "expense" && (
            <select
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
