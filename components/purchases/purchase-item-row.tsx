"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupees } from "@/lib/format/money";

export interface PurchaseItemData {
  productId: string;
  productName: string;
  unit: string;
  unitsPerPack: number | null;
  quantity: number;
  costPerUnit: number;
}

export function PurchaseItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: PurchaseItemData;
  index: number;
  onChange: (index: number, patch: Partial<PurchaseItemData>) => void;
  onRemove: (index: number) => void;
}) {
  const hasPack = item.unitsPerPack !== null && item.unit === "pcs";
  const [buyByPack, setBuyByPack] = useState(hasPack);
  const [packInput, setPackInput] = useState(
    hasPack && item.unitsPerPack ? String(item.quantity / item.unitsPerPack) : ""
  );

  function handlePackChange(newPackStr: string) {
    setPackInput(newPackStr);
    const packs = parseFloat(newPackStr);
    if (!Number.isNaN(packs) && packs > 0 && item.unitsPerPack) {
      onChange(index, { quantity: packs * item.unitsPerPack });
    }
  }

  function handleQuantityChange(newQty: string) {
    const qty = parseFloat(newQty);
    if (!Number.isNaN(qty) && qty > 0) {
      onChange(index, { quantity: qty });
      if (buyByPack && item.unitsPerPack) {
        setPackInput(String(qty / item.unitsPerPack));
      }
    }
  }

  function toggleBuyMode(usePack: boolean) {
    setBuyByPack(usePack);
    if (usePack && item.unitsPerPack) {
      const packs = item.quantity / item.unitsPerPack;
      setPackInput(Number.isInteger(packs) ? String(packs) : packs.toFixed(2));
    } else {
      setPackInput("");
    }
  }

  const lineTotal = item.quantity * item.costPerUnit;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{item.productName}</p>
          <p className="text-xs text-muted-foreground">{item.unit}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-destructive" onClick={() => onRemove(index)}>
          Remove
        </Button>
      </div>

      {hasPack && item.unitsPerPack && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={buyByPack ? "default" : "outline"}
            size="sm"
            onClick={() => toggleBuyMode(true)}
          >
            By pack
          </Button>
          <Button
            type="button"
            variant={!buyByPack ? "default" : "outline"}
            size="sm"
            onClick={() => toggleBuyMode(false)}
          >
            By piece
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`qty-${index}`} className="text-xs">
            {buyByPack && hasPack ? `Quantity (packs × ${item.unitsPerPack})` : "Quantity"}
          </Label>
          {buyByPack && hasPack ? (
            <Input
              id={`qty-${index}`}
              type="number"
              min="0.01"
              step="1"
              inputMode="decimal"
              value={packInput}
              onChange={(e) => handlePackChange(e.target.value)}
              placeholder="0"
            />
          ) : (
            <Input
              id={`qty-${index}`}
              type="number"
              min="0.01"
              step={item.unit === "pcs" ? "1" : "0.01"}
              inputMode="decimal"
              value={item.quantity || ""}
              onChange={(e) => handleQuantityChange(e.target.value)}
              placeholder="0"
            />
          )}
          {buyByPack && hasPack && item.unitsPerPack && (
            <p className="text-xs text-muted-foreground">
              = {item.quantity} {item.unit}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`cost-${index}`} className="text-xs">Cost per unit (Rs)</Label>
          <Input
            id={`cost-${index}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.costPerUnit || ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v) && v >= 0) onChange(index, { costPerUnit: v });
            }}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Line total</span>
        <span className="font-medium tabular-nums">{formatRupees(lineTotal)}</span>
      </div>
    </div>
  );
}
