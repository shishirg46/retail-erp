import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { NewSale } from "@/components/sales/new-sale";
import { useCart } from "@/stores/cart";

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    replace: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    MockApiError,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/sales/new",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
  ApiError: mocks.MockApiError,
  isAuthLostError: () => false,
  isRateLimitedError: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { apiGet, apiPost, MockApiError } = mocks;

const RICE = {
  id: "p-1",
  name: "Rice",
  category: "Grocery",
  unit: "pcs",
  costPrice: 55,
  currentPrice: 70,
  stockQty: 13,
  priceTiers: [],
  createdAt: "2026-08-01T00:00:00.000Z",
};

const OIL = {
  id: "p-2",
  name: "Oil",
  category: "Grocery",
  unit: "L",
  costPrice: 150,
  currentPrice: 180,
  stockQty: 10,
  priceTiers: [],
  createdAt: "2026-08-01T00:00:00.000Z",
};

const PRODUCTS_PAGE = { data: [RICE, OIL], paging: { next: null, hasMore: false } };
const CUSTOMERS_PAGE = {
  data: [{ id: "c-1", name: "Ram", contact: null, balanceOwed: 0, createdAt: "2026-08-01T00:00:00.000Z" }],
  paging: { next: null, hasMore: false },
};

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const saveButton = () => screen.getAllByRole("button", { name: "Save sale" })[0];

describe("NewSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCart.setState({ items: [], paymentType: "CASH", customerId: null });
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue(PRODUCTS_PAGE);
  });

  it("loads products and adds one to the cart with a running total", async () => {
    const user = userEvent.setup();
    renderWithClient(<NewSale />);

    expect(await screen.findByRole("button", { name: "Add Rice to cart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Oil to cart" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Rice to cart" }));

    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getByTestId("cart-total")).toHaveTextContent("रू 70.00");
  });

  it("shows the lowest tier hint on a tiered product", async () => {
    const tiered = {
      ...OIL,
      currentPrice: 22,
      priceTiers: [{ minQty: 3, price: 20 }],
    };
    apiGet.mockResolvedValue({ data: [tiered], paging: { next: null, hasMore: false } });

    renderWithClient(<NewSale />);

    expect(await screen.findByText("3+ for रू 20.00")).toBeInTheDocument();
  });

  it("posts the sale and resets the cart on success", async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({
      id: "s-1",
      total: 70,
      paymentType: "CASH",
      customerId: null,
      date: "2026-08-16T00:00:00.000Z",
      items: [],
      voidInfo: { voidedAt: null, reason: null },
      status: "ACTIVE",
      voidedAt: null,
      voidReason: null,
    });

    renderWithClient(<NewSale />);
    await screen.findByRole("button", { name: "Add Rice to cart" });
    await user.click(screen.getByRole("button", { name: "Add Rice to cart" }));

    await user.click(saveButton());

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/sales", {
        paymentType: "CASH",
        items: [{ productId: "p-1", quantity: 1 }],
      })
    );
    expect(toast.success).toHaveBeenCalledWith("Sale saved रू 70.00");
    await waitFor(() => expect(screen.queryByText("1 item")).not.toBeInTheDocument());
  });

  it("surfaces the API error inline when saving fails", async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(new MockApiError(409, "Insufficient stock for Rice"));

    renderWithClient(<NewSale />);
    await screen.findByRole("button", { name: "Add Rice to cart" });
    await user.click(screen.getByRole("button", { name: "Add Rice to cart" }));

    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient stock for Rice");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("requires a customer before saving a CREDIT sale", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === "/api/customers"
        ? Promise.resolve(CUSTOMERS_PAGE)
        : Promise.resolve(PRODUCTS_PAGE)
    );

    renderWithClient(<NewSale />);
    await screen.findByRole("button", { name: "Add Rice to cart" });
    await user.click(screen.getByRole("button", { name: "Add Rice to cart" }));

    expect(saveButton()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Credit" }));
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Select a customer for credit sales.")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Ram/i }));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(saveButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/sales", {
        paymentType: "CREDIT",
        customerId: "c-1",
        items: [{ productId: "p-1", quantity: 1 }],
      })
    );
  });

  it("creates a new credit customer on the spot and uses it for the sale", async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === "/api/customers"
        ? Promise.resolve({ data: [], paging: { next: null, hasMore: false } })
        : Promise.resolve(PRODUCTS_PAGE)
    );
    const created = {
      id: "c-2",
      name: "Sita",
      contact: null,
      balanceOwed: 0,
      createdAt: "2026-08-16T00:00:00.000Z",
    };
    apiPost.mockImplementation((path: string) =>
      path === "/api/customers" ? Promise.resolve(created) : Promise.reject(new Error("unexpected"))
    );

    renderWithClient(<NewSale />);
    await screen.findByRole("button", { name: "Add Rice to cart" });
    await user.click(screen.getByRole("button", { name: "Add Rice to cart" }));
    await user.click(screen.getByRole("button", { name: "Credit" }));

    await user.click(await screen.findByRole("button", { name: "New customer" }));
    await user.type(screen.getByLabelText("New customer name"), "Sita");
    await user.click(screen.getByRole("button", { name: "Create customer" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/customers", { name: "Sita" })
    );
    await waitFor(() => expect(screen.getByText("Sita")).toBeInTheDocument());
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(saveButton());
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/api/sales", {
        paymentType: "CREDIT",
        customerId: "c-2",
        items: [{ productId: "p-1", quantity: 1 }],
      })
    );
  });

  it("shows an empty state when no products match", async () => {
    apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<NewSale />);

    expect(await screen.findByText("No products found")).toBeInTheDocument();
  });
});
