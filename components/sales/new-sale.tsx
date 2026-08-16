"use client";

import { ChevronUp, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { CartPanel } from "@/components/sales/cart-panel";
import { ProductCard } from "@/components/sales/product-card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Paginated } from "@/lib/api/types";
import { formatRupees } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { Product } from "@/modules/products/product.types";
import { useCart } from "@/stores/cart";

// One request covers a small shop's catalogue; Phase C adds real pagination.
const PRODUCT_LIMIT = "500";

// Search + category live in the URL (searchParams) so the filter state is
// shareable and survives reloads (plan §13). The URL is the source of truth
// for the product query; the input is initialized from it and pushes changes
// back after a short debounce (typing) or immediately (already-synced values),
// so the grid never refetches on every keystroke.
function useProductFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const urlSearch = searchParams.get("search") ?? "";
  const urlCategory = searchParams.get("category") ?? "";

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [category, setCategory] = useState(urlCategory);

  const commit = useCallback(
    (nextSearch: string, nextCategory: string) => {
      const params = new URLSearchParams();
      if (nextSearch) params.set("search", nextSearch);
      if (nextCategory) params.set("category", nextCategory);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  useEffect(() => {
    const id = setTimeout(
      () => commit(searchInput, category),
      searchInput === urlSearch && category === urlCategory ? 0 : 250
    );
    return () => clearTimeout(id);
  }, [searchInput, category, urlSearch, urlCategory, commit]);

  return { searchInput, setSearchInput, category, setCategory, urlSearch, urlCategory };
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 desktop:grid-cols-3">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-[96px] animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

// New Sale (plan §12.1) — the POS centerpiece. Product picker on the left (or
// top on mobile), cart panel on the right (desktop/tablet) or in a bottom
// sheet behind the sticky cart bar (mobile). Both CASHIER and OWNER can sell
// (D9.3).
export function NewSale() {
  const { searchInput, setSearchInput, category, setCategory, urlSearch, urlCategory } =
    useProductFilters();
  const [cartOpen, setCartOpen] = useState(false);

  const itemCount = useCart((state) => state.items.reduce((count, line) => count + line.qty, 0));
  const total = useCart((state) =>
    state.items.reduce((sum, line) => sum + line.pricePerUnit * line.qty, 0)
  );

  const addToCart = useCallback((product: Product) => {
    useCart.getState().addItem({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      pricePerUnit: product.currentPrice,
      stockQty: product.stockQty,
      tiers: product.priceTiers,
    });
  }, []);

  const products = useQuery({
    queryKey: queryKeys.products.list(urlSearch, urlCategory),
    queryFn: async () => {
      const res = await api.get<Paginated<Product>>("/api/products", {
        search: urlSearch || undefined,
        category: urlCategory || undefined,
        limit: PRODUCT_LIMIT,
      });
      return res.data;
    },
  });

  const categories = Array.from(
    new Set((products.data ?? []).map((product) => product.category).filter((c): c is string => Boolean(c)))
  ).sort();

  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,380px)] desktop:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <section aria-label="Products" className="max-md:pb-20">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = products.data?.[0];
                if (first && first.stockQty > 0) addToCart(first);
              }
            }}
            placeholder="Search products…"
            aria-label="Search products"
            className="h-11 pl-9 text-base"
            enterKeyHint="search"
          />
        </div>

        {categories.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
            <CategoryChip active={category === ""} onClick={() => setCategory("")}>
              All
            </CategoryChip>
            {categories.map((value) => (
              <CategoryChip
                key={value}
                active={category === value}
                onClick={() => setCategory(category === value ? "" : value)}
              >
                {value}
              </CategoryChip>
            ))}
          </div>
        ) : null}

        <div className="mt-3">
          {products.isPending ? <ProductGridSkeleton /> : null}

          {products.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              Couldn&apos;t load products.{" "}
              <button
                type="button"
                onClick={() => products.refetch()}
                className="underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : null}

          {products.isSuccess && products.data.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center">
              <p className="text-sm font-medium text-foreground">No products found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchInput ? (
                  <>
                    Try a different search.{" "}
                    <button
                      type="button"
                      onClick={() => setSearchInput("")}
                      className="text-primary underline underline-offset-2"
                    >
                      Clear search
                    </button>
                  </>
                ) : (
                  "No products yet — add products to start selling."
                )}
              </p>
            </div>
          ) : null}

          {products.isSuccess && products.data.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 desktop:grid-cols-3">
              {products.data.map((product) => (
                <ProductCard key={product.id} product={product} onAdd={addToCart} />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <aside className="hidden tablet:block">
        <div className="sticky top-[4.5rem]">
          <CartPanel />
        </div>
      </aside>

      {itemCount > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 px-4 pb-2 pt-2 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            data-testid="mobile-cart-bar"
            className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm"
          >
            <span className="text-sm font-medium">
              {itemCount} item{itemCount === 1 ? "" : "s"}
            </span>
            <span className="text-lg font-semibold tabular-nums" aria-live="polite">
              {formatRupees(total)}
            </span>
            <ChevronUp className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-5 overflow-y-auto pb-safe"
        >
          <SheetHeader>
            <SheetTitle>Review sale</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-2">
            <CartPanel onSuccess={() => setCartOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
