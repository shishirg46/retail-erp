import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PurchasesList } from "@/components/purchases/purchases-list";
import { PurchaseDetail } from "@/components/purchases/purchase-detail";
import { PurchaseForm } from "@/components/purchases/purchase-form";
import { PurchaseVoidForm } from "@/components/purchases/purchase-void-form";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/purchases",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
  ApiError: class MockApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const suppliers = [
  { id: "sup-1", name: "Kathmandu Traders", contact: "9801112222", balanceOwed: 0, openingBalance: 0, createdAt: "2026-08-10T00:00:00.000Z" },
  { id: "sup-2", name: "Bhaktapur Wholesalers", contact: null, balanceOwed: 0, openingBalance: 0, createdAt: "2026-08-10T00:00:00.000Z" },
];

const products = [
  { id: "prod-1", name: "Basmati Rice", unit: "kg", costPrice: 120, currentPrice: 150, stockQty: 100, unitsPerPack: null, priceTiers: [] },
  { id: "prod-2", name: "Biscuits", unit: "pcs", costPrice: 10, currentPrice: 15, stockQty: 500, unitsPerPack: 24, priceTiers: [] },
  { id: "prod-3", name: "Cooking Oil", unit: "liter", costPrice: 180, currentPrice: 200, stockQty: 50, unitsPerPack: null, priceTiers: [] },
];

const purchase = {
  id: "pur-1",
  supplierId: "sup-1",
  paymentType: "CASH" as const,
  total: 3750,
  date: "2026-08-15T10:00:00.000Z",
  items: [
    { id: "item-1", purchaseId: "pur-1", productId: "prod-1", productName: "Basmati Rice", qty: 25, costPerUnit: 120 },
    { id: "item-2", purchaseId: "pur-1", productId: "prod-3", productName: "Cooking Oil", qty: 5, costPerUnit: 150 },
  ],
  status: "ACTIVE" as const,
  voidedAt: null,
  voidReason: null,
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* PurchasesList                                                             */
/* ────────────────────────────────────────────────────────────────────────── */
describe("PurchasesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PurchasesList />);
    expect(screen.getByText(/Loading purchases/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } }).mockResolvedValueOnce([]);
    renderWithClient(<PurchasesList />);
    await waitFor(() => expect(screen.getByText("No purchases found")).toBeInTheDocument());

    mocks.apiGet.mockReset();
    mocks.apiGet.mockRejectedValueOnce(new Error("Failed to load")).mockRejectedValueOnce([]);
    renderWithClient(<PurchasesList />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders purchases with supplier name, total, date, and payment type", async () => {
    mocks.apiGet
      .mockResolvedValueOnce({ data: [purchase], paging: { next: null, hasMore: false } })
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchasesList />);

    expect((await screen.findAllByText("Kathmandu Traders")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("CASH").length).toBeGreaterThan(0);
    expect(screen.getByText(/3,750/)).toBeInTheDocument();
  });

  it("shows payment-type filter buttons", async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } }).mockResolvedValueOnce([]);
    renderWithClient(<PurchasesList />);

    await screen.findByText("No purchases found");
    expect(screen.getByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CASH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CREDIT" })).toBeInTheDocument();
  });

  it("shows supplier filter dropdown", async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } }).mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchasesList />);

    await screen.findByText("No purchases found");
    expect(screen.getByDisplayValue("All suppliers")).toBeInTheDocument();
  });

  it("navigates to purchase detail", async () => {
    mocks.apiGet
      .mockResolvedValueOnce({ data: [purchase], paging: { next: null, hasMore: false } })
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchasesList />);

    const link = await screen.findByRole("link", { name: /View purchase/i });
    expect(link).toHaveAttribute("href", "/purchases/pur-1");
  });

  it("shows New purchase button", async () => {
    mocks.apiGet.mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } }).mockResolvedValueOnce([]);
    renderWithClient(<PurchasesList />);
    await screen.findByText("No purchases found");
    expect(screen.getByRole("link", { name: /New purchase/i })).toHaveAttribute("href", "/purchases/new");
  });

  it("displays VOIDED badge for voided purchases", async () => {
    const voidedPurchase = { ...purchase, status: "VOIDED" as const };
    mocks.apiGet
      .mockResolvedValueOnce({ data: [voidedPurchase], paging: { next: null, hasMore: false } })
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchasesList />);

    await screen.findByText("VOIDED");
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* PurchaseForm                                                              */
/* ────────────────────────────────────────────────────────────────────────── */
describe("PurchaseForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("loads suppliers for selection", async () => {
    mocks.apiGet.mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseForm />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByText("Bhaktapur Wholesalers")).toBeInTheDocument();
  });

  it("shows payment type toggle with CASH/CREDIT explanations", async () => {
    mocks.apiGet.mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseForm />);

    await screen.findByText("CASH");
    expect(screen.getByText("CREDIT")).toBeInTheDocument();
    expect(screen.getByText(/CASH withdraws from the wallet immediately/i)).toBeInTheDocument();
  });

  it("shows CREDIT explanation when CREDIT is selected", async () => {
    mocks.apiGet.mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await screen.findByText("CREDIT");
    await user.click(screen.getByRole("button", { name: "CREDIT" }));
    expect(screen.getByText(/CREDIT increases the supplier balance/i)).toBeInTheDocument();
  });

  it("adds a product and shows cost pre-filled from costPrice", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products);
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.click(screen.getByRole("button", { name: /Add product/i }));

    expect(await screen.findByText("Basmati Rice")).toBeInTheDocument();
    expect(screen.getByText("(kg)")).toBeInTheDocument();
  });

  it("adds multiple products and shows grand total", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products)
      .mockResolvedValueOnce(products);
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Basmati Rice/i }));

    expect(screen.getByText("Grand total")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Cooking Oil/i }));

    expect(screen.getByText("Cooking Oil")).toBeInTheDocument();
  });

  it("shows Pack toggle for pcs products with unitsPerPack", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products);
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Biscuits/i }));

    expect(screen.getByText("By pack")).toBeInTheDocument();
    expect(screen.getByText("By piece")).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity \(packs × 24\)/i)).toBeInTheDocument();
  });

  it("disables Record purchase when no supplier or items", async () => {
    mocks.apiGet.mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseForm />);

    await screen.findByText("Kathmandu Traders");
    const btn = screen.getByRole("button", { name: /Record purchase/i });
    expect(btn).toBeDisabled();
  });

  it("submits purchase and navigates to detail on success", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products);
    mocks.apiPost.mockResolvedValue({ id: "pur-new" });
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("option", { name: "Kathmandu Traders" })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), "sup-1");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Basmati Rice/i }));
    await user.click(screen.getByRole("button", { name: /Record purchase/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/purchases", expect.objectContaining({
        supplierId: "sup-1",
        paymentType: "CASH",
      })),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/purchases/pur-new"));
  });

  it("displays server error on failed creation", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products);
    mocks.apiPost.mockRejectedValue(new Error("Supplier not found"));
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("option", { name: "Kathmandu Traders" })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), "sup-1");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Basmati Rice/i }));
    await user.click(screen.getByRole("button", { name: /Record purchase/i }));

    await waitFor(() => expect(screen.getByText("Supplier not found")).toBeInTheDocument());
  });

  it("allows removing an added item", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(suppliers)
      .mockResolvedValueOnce(products);
    renderWithClient(<PurchaseForm />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.click(screen.getByRole("button", { name: /Add product/i }));
    await user.click(await screen.findByRole("button", { name: /Basmati Rice/i }));
    expect(screen.getByText("Basmati Rice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove/i }));
    expect(screen.queryByText("Basmati Rice")).not.toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* PurchaseDetail                                                            */
/* ────────────────────────────────────────────────────────────────────────── */
describe("PurchaseDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("renders purchase info, items with product names, and total", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByText("CASH")).toBeInTheDocument();
    expect(screen.getByText("Basmati Rice")).toBeInTheDocument();
    expect(screen.getByText("Cooking Oil")).toBeInTheDocument();
    expect(screen.getByText(/3,750/)).toBeInTheDocument();
  });

  it("shows loading and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);
    expect(screen.getByText(/Loading purchase/i)).toBeInTheDocument();

    mocks.apiGet.mockReset();
    mocks.apiGet.mockRejectedValueOnce(new Error("Not found")).mockResolvedValueOnce([]);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeInTheDocument());
  });

  it("shows ACTIVE badge", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);

    await screen.findByText("ACTIVE");
  });

  it("shows void button for OWNER on ACTIVE purchase", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);

    await screen.findByText("ACTIVE");
    expect(screen.getByRole("button", { name: /Void purchase/i })).toBeInTheDocument();
  });

  it("hides void button for CASHIER", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="CASHIER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.queryByRole("button", { name: /Void purchase/i })).not.toBeInTheDocument();
  });

  it("hides void button for VOIDED purchase", async () => {
    const voidedPurchase = { ...purchase, status: "VOIDED" as const, voidReason: "Wrong items" };
    mocks.apiGet
      .mockResolvedValueOnce(voidedPurchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);

    await screen.findByText("VOIDED");
    expect(screen.queryByRole("button", { name: /Void purchase/i })).not.toBeInTheDocument();
    expect(screen.getByText("Wrong items")).toBeInTheDocument();
  });

  it("shows item quantities and cost per unit", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce(suppliers);
    renderWithClient(<PurchaseDetail id="pur-1" role="OWNER" />);

    await screen.findByText("Basmati Rice");
    expect(screen.getAllByText(/25 ×/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5 ×/).length).toBeGreaterThan(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* PurchaseVoidForm                                                          */
/* ────────────────────────────────────────────────────────────────────────── */
describe("PurchaseVoidForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockReset();
  });

  it("validates reason is required", () => {
    renderWithClient(<PurchaseVoidForm purchaseId="pur-1" onDone={vi.fn()} />);
    const confirmBtn = screen.getByRole("button", { name: /Confirm void/i });
    expect(confirmBtn).toBeDisabled();
  });

  it("submits void with reason and note", async () => {
    const onDone = vi.fn();
    mocks.apiPost.mockResolvedValue({});
    renderWithClient(<PurchaseVoidForm purchaseId="pur-1" onDone={onDone} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Void reason/i), "Wrong items delivered");
    await user.type(screen.getByLabelText(/Note/i), "Partial shipment");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/purchases/pur-1/void", {
        reason: "Wrong items delivered",
        note: "Partial shipment",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("submits void with reason only (no note)", async () => {
    const onDone = vi.fn();
    mocks.apiPost.mockResolvedValue({});
    renderWithClient(<PurchaseVoidForm purchaseId="pur-1" onDone={onDone} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Void reason/i), "Duplicate entry");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/purchases/pur-1/void", {
        reason: "Duplicate entry",
      }),
    );
  });

  it("displays server error on void failure", async () => {
    mocks.apiPost.mockRejectedValue(new Error("Already voided"));
    renderWithClient(<PurchaseVoidForm purchaseId="pur-1" onDone={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Void reason/i), "Error test");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));

    await waitFor(() => expect(screen.getByText("Already voided")).toBeInTheDocument());
  });
});
