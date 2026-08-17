import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockMovementsList } from "@/components/stock/stock-movements-list";
import { StockAdjustForm } from "@/components/stock/stock-adjust-form";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/stock/movements",
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

const movement = {
  id: "mov-1",
  productId: "prod-1",
  qtyChange: -2,
  reason: "SALE",
  date: "2026-08-15T10:00:00.000Z",
  note: null,
  saleId: "sale-1",
  purchaseId: null,
  status: "ACTIVE",
  voidedAt: null,
  voidReason: null,
};

const product = {
  id: "prod-1",
  name: "Rice",
  category: "Grains",
  unit: "kg",
  costPrice: 50,
  currentPrice: 80,
  stockQty: 120,
  priceTiers: [],
  createdAt: "2026-08-10T00:00:00.000Z",
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("StockMovementsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<StockMovementsList />);
    expect(screen.getByText(/Loading stock movements/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<StockMovementsList />);
    await waitFor(() => expect(screen.getByText("No stock movements found")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load"));
    renderWithClient(<StockMovementsList />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders movements and supports reason filtering", async () => {
    mocks.apiGet.mockResolvedValue({ data: [movement], paging: { next: null, hasMore: false } });
    renderWithClient(<StockMovementsList />);

    await waitFor(() => expect(screen.getByText("Qty change")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Damage/i }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("reason=DAMAGE"), { scroll: false }));
  });
});

describe("StockAdjustForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("shows error on failed adjustment", async () => {
    mocks.apiGet.mockResolvedValue([product]);
    mocks.apiPost.mockRejectedValue(new Error("Insufficient stock"));
    renderWithClient(<StockAdjustForm />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("option", { name: /Rice/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Product/i), "prod-1");
    await user.type(screen.getByLabelText(/Quantity damaged/i), "500");
    await user.click(screen.getByRole("button", { name: /Adjust stock/i }));

    await waitFor(() => expect(screen.getByText("Insufficient stock")).toBeInTheDocument());
  });

  it("submits a successful adjustment", async () => {
    mocks.apiGet.mockResolvedValue([product]);
    mocks.apiPost.mockResolvedValue({ product: { id: "prod-1", stockQty: 110 }, movement });
    renderWithClient(<StockAdjustForm />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByRole("option", { name: /Rice/ })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Product/i), "prod-1");
    expect(screen.getByText("120 kg")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Quantity damaged/i), "10");
    await user.click(screen.getByRole("button", { name: /Adjust stock/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/stock/adjustments", expect.objectContaining({ reason: "DAMAGE", quantity: 10 })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/stock/movements"));
  });
});
