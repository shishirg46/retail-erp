import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SaleDetail } from "@/components/sales/sale-detail";
import { SalesList } from "@/components/sales/sales-list";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/sales",
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

const sale = {
  id: "sale-123",
  customerId: null,
  paymentType: "CASH",
  total: 245.5,
  date: "2026-08-16T09:15:00.000Z",
  status: "ACTIVE",
  voidedAt: null,
  voidReason: null,
  items: [
    { id: "item-1", saleId: "sale-123", productId: "prod-1", productName: "Widget", qty: 2, pricePerUnit: 80, lineTotal: 160 },
    { id: "item-2", saleId: "sale-123", productId: "prod-2", productName: "Gadget", qty: 1.5, pricePerUnit: 45, lineTotal: 67.5 },
  ],
  voidInfo: { voidedAt: null, reason: null },
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("SalesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("shows loading, empty, and error states for the sales list", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SalesList role="OWNER" />);
    expect(screen.getByText(/Loading sales/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<SalesList role="OWNER" />);
    await waitFor(() => expect(screen.getByText("No sales found")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load sales"));
    renderWithClient(<SalesList role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Failed to load sales/i)).toBeInTheDocument());
  });

  it("renders sales, applies payment-type filtering, and supports pagination", async () => {
    mocks.apiGet.mockResolvedValue({ data: [sale], paging: { next: "next-cursor", hasMore: true } });
    renderWithClient(<SalesList role="OWNER" />);

    expect(await screen.findByText("Widget + 1 more")).toBeInTheDocument();
    expect(screen.getByText("रू 245.50")).toBeInTheDocument();
    expect(screen.getAllByText("Cash").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Credit" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("paymentType=CREDIT"), { scroll: false }));

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("cursor="), { scroll: false }));
  });

  it("navigates to the sale detail from the list view", async () => {
    mocks.apiGet.mockResolvedValue({ data: [sale], paging: { next: null, hasMore: false } });
    renderWithClient(<SalesList role="OWNER" />);

    const link = await screen.findByRole("link", { name: /View sale/i });
    expect(link).toHaveAttribute("href", "/sales/sale-123");
  });
});

describe("SaleDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("renders sale details and shows the void action only to OWNER", async () => {
    mocks.apiGet.mockResolvedValue(sale);
    const { rerender } = renderWithClient(<SaleDetail id="sale-123" role="CASHIER" />);
    expect(await screen.findByText("Sale #SALE-123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Void sale/i })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <SaleDetail id="sale-123" role="OWNER" />
      </QueryClientProvider>
    );
    expect(await screen.findByRole("button", { name: /Void sale/i })).toBeInTheDocument();
  });

  it("confirms and submits a void, and handles a failing void request", async () => {
    mocks.apiGet.mockResolvedValue(sale);
    mocks.apiPost.mockResolvedValue({ voidId: "void-1", reason: "Customer requested refund", note: null, voidedAt: "2026-08-16T00:00:00.000Z" });

    renderWithClient(<SaleDetail id="sale-123" role="OWNER" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Void sale/i }));
    const input = await screen.findByLabelText(/Void reason/i);
    await user.type(input, "Customer requested refund");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/sales/sale-123/void", { reason: "Customer requested refund" }));

    mocks.apiPost.mockRejectedValueOnce(new Error("Void failed"));
    renderWithClient(<SaleDetail id="sale-123" role="OWNER" />);
    await user.click(await screen.findByRole("button", { name: /Void sale/i }));
    await user.type(await screen.findByLabelText(/Void reason/i), "Customer requested refund");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));
    await waitFor(() => expect(screen.getByText("Void failed")).toBeInTheDocument());
  });

  it("displays product names instead of UUIDs and uses authoritative line totals", async () => {
    mocks.apiGet.mockResolvedValue(sale);
    renderWithClient(<SaleDetail id="sale-123" role="OWNER" />);

    await waitFor(() => expect(screen.getByText("Widget")).toBeInTheDocument());
    expect(screen.getByText("Gadget")).toBeInTheDocument();

    expect(screen.queryByText(/prod-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/prod-2/)).not.toBeInTheDocument();

    expect(screen.getByText("रू 160.00")).toBeInTheDocument();
    expect(screen.getByText("रू 67.50")).toBeInTheDocument();
  });
});
