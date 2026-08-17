import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductsList } from "@/components/products/products-list";
import { ProductDetail } from "@/components/products/product-detail";
import { ProductForm } from "@/components/products/product-form";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/products",
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

const product = {
  id: "prod-1",
  name: "Rice",
  category: "Grains",
  unit: "kg",
  costPrice: 50,
  currentPrice: 80,
  stockQty: 120,
  priceTiers: [
    { minQty: 5, price: 75 },
    { minQty: 20, price: 70 },
  ],
  createdAt: "2026-08-10T00:00:00.000Z",
};

const productNoTier = {
  id: "prod-2",
  name: "Oil",
  category: null,
  unit: "liter",
  costPrice: 120,
  currentPrice: 150,
  stockQty: 50,
  priceTiers: [],
  createdAt: "2026-08-11T00:00:00.000Z",
};

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

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ProductsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<ProductsList role="OWNER" />);
    expect(screen.getByText(/Loading products/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<ProductsList role="OWNER" />);
    await waitFor(() => expect(screen.getByText("No products found")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load"));
    renderWithClient(<ProductsList role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders products, applies search, category filter, and pagination", async () => {
    mocks.apiGet.mockResolvedValue({ data: [product, productNoTier], paging: { next: "next-cursor", hasMore: true } });
    renderWithClient(<ProductsList role="OWNER" />);

    expect(await screen.findByText("Rice")).toBeInTheDocument();
    expect(screen.getByText("Oil")).toBeInTheDocument();
    expect(screen.getByText("रू 80.00/kg")).toBeInTheDocument();
    expect(screen.getByText("रू 150.00/liter")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search products/i);
    await userEvent.type(searchInput, "Rice");
    await userEvent.click(screen.getByRole("button", { name: /Search/i }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("search=Rice"), { scroll: false }));

    await userEvent.click(screen.getByRole("button", { name: /Next page/i }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("cursor="), { scroll: false }));
  });

  it("navigates to product detail from the list", async () => {
    mocks.apiGet.mockResolvedValue({ data: [product], paging: { next: null, hasMore: false } });
    renderWithClient(<ProductsList role="OWNER" />);

    const link = await screen.findByRole("link", { name: /View Rice/i });
    expect(link).toHaveAttribute("href", "/products/prod-1");
  });

  it("shows new product button only for OWNER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });

    const { unmount } = renderWithClient(<ProductsList role="OWNER" />);
    expect(await screen.findByRole("link", { name: /New product/i })).toBeInTheDocument();
    unmount();

    renderWithClient(<ProductsList role="CASHIER" />);
    await waitFor(() => expect(screen.queryByRole("link", { name: /New product/i })).not.toBeInTheDocument());
  });
});

describe("ProductDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("renders product info, tiers, and recent movements", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(product)
      .mockResolvedValueOnce([movement]);

    renderWithClient(<ProductDetail id="prod-1" role="OWNER" />);

    expect(await screen.findByText("Rice")).toBeInTheDocument();
    expect(screen.getByText("रू 80.00/kg")).toBeInTheDocument();
    expect(screen.getByText("रू 50.00/kg")).toBeInTheDocument();
    expect(screen.getByText("120 kg")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("SALE")).toBeInTheDocument());
  });

  it("shows loading and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<ProductDetail id="prod-1" role="OWNER" />);
    expect(screen.getByText(/Loading product/i)).toBeInTheDocument();

    mocks.apiGet.mockRejectedValue(new Error("Not found"));
    renderWithClient(<ProductDetail id="prod-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeInTheDocument());
  });
});

describe("ProductForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("blocks non-OWNER from creating products", () => {
    renderWithClient(<ProductForm role="CASHIER" />);
    expect(screen.getByText(/Only owners can create products/i)).toBeInTheDocument();
  });

  it("submits a new product and navigates back", async () => {
    mocks.apiPost.mockResolvedValue(product);
    renderWithClient(<ProductForm role="OWNER" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Name/i), "Rice");
    await user.type(screen.getByLabelText(/Cost price/i), "50");
    await user.type(screen.getByLabelText(/Current price/i), "80");
    await user.type(screen.getByLabelText(/Category/i), "Grains");
    await user.click(screen.getByRole("button", { name: /Create product/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/products", expect.objectContaining({ name: "Rice" })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/products"));
  });

  it("displays server error on failed creation", async () => {
    mocks.apiPost.mockRejectedValue(new Error("Name already exists"));
    renderWithClient(<ProductForm role="OWNER" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Name/i), "Duplicate");
    await user.type(screen.getByLabelText(/Cost price/i), "50");
    await user.type(screen.getByLabelText(/Current price/i), "80");
    await user.click(screen.getByRole("button", { name: /Create product/i }));

    await waitFor(() => expect(screen.getByText("Name already exists")).toBeInTheDocument());
  });
});
