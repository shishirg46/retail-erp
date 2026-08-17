"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

export function PurchaseVoidForm({
  purchaseId,
  onDone,
}: {
  purchaseId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const voidMutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new ApiError(400, "Reason is required");
      return api.post(`/api/purchases/${purchaseId}/void`, {
        reason: reason.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all });
      onDone();
    },
    onError: (err: ApiError) => {
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <Label htmlFor="void-reason">Void reason *</Label>
        <Input
          id="void-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for voiding"
        />
        <Label htmlFor="void-note">Note (optional)</Label>
        <Input
          id="void-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Additional note"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || voidMutation.isPending}
            onClick={() => voidMutation.mutate()}
          >
            {voidMutation.isPending ? "Confirming…" : "Confirm void"}
          </Button>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
