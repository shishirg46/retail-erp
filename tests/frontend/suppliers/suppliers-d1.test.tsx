import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuppliersList } from "@/components/suppliers/suppliers-list";
import { SupplierDetail } from "@/components/suppliers/supplier-detail";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { SupplierPayForm } from "@/components/suppliers/supplier-pay-form";
import { SupplierPaymentHistory } from "@/components/suppliers/supplier-payment-history";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/suppliers",
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

const supplier = {
  id: "sup-1",
  name: "Kathmandu Traders",
  contact: "9801112222",
  balanceOwed: 15000,
  openingBalance: 10000,
  createdAt: "2026-08-10T00:00:00.000Z",
};

const supplierPrepaid = {
  id: "sup-2",
  name: "Bhaktapur Wholesalers",
  contact: null,
  balanceOwed: -3000,
  openingBalance: 0,
  createdAt: "2026-08-11T00:00:00.000Z",
};

const payment = {
  id: "spay-1",
  supplierId: "sup-1",
  amount: 2000,
  date: "2026-08-15T10:00:00.000Z",
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
/* SuppliersList                                                             */
/* ────────────────────────────────────────────────────────────────────────── */
describe("SuppliersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SuppliersList role="OWNER" />);
    expect(screen.getByText(/Loading suppliers/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);
    await waitFor(() => expect(screen.getByText("No suppliers found")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load"));
    renderWithClient(<SuppliersList role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders suppliers with name and contact", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplier, supplierPrepaid], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);

    expect(await screen.findByText("Kathmandu Traders")).toBeInTheDocument();
    expect(screen.getByText("Bhaktapur Wholesalers")).toBeInTheDocument();
    expect(screen.getByText("9801112222")).toBeInTheDocument();
  });

  it("displays positive balanceOwed as shop-owed", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplier], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByText(/Shop owes/)).toBeInTheDocument();
  });

  it("displays negative balanceOwed as prepaid", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplierPrepaid], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);

    await screen.findByText("Bhaktapur Wholesalers");
    expect(screen.getByText(/Prepaid/)).toBeInTheDocument();
  });

  it("navigates to supplier detail", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplier], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);

    const link = await screen.findByRole("link", { name: /View Kathmandu Traders/i });
    expect(link).toHaveAttribute("href", "/suppliers/sup-1");
  });

  it("shows Pay supplier link for OWNER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplier], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByRole("link", { name: /Pay supplier/i })).toHaveAttribute("href", "/suppliers/sup-1/pay");
  });

  it("hides Pay supplier link for CASHIER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [supplier], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="CASHIER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.queryByRole("link", { name: /Pay supplier/i })).not.toBeInTheDocument();
  });

  it("shows New supplier button only for OWNER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="OWNER" />);
    expect(await screen.findByRole("link", { name: /New supplier/i })).toBeInTheDocument();
  });

  it("hides New supplier button for CASHIER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<SuppliersList role="CASHIER" />);
    await waitFor(() => expect(screen.getByText("No suppliers found")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /New supplier/i })).not.toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* SupplierDetail                                                            */
/* ────────────────────────────────────────────────────────────────────────── */
describe("SupplierDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("renders supplier info, balance, and opening balance", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(supplier)
      .mockResolvedValueOnce({ data: [payment], paging: { next: null, hasMore: false } });

    renderWithClient(<SupplierDetail id="sup-1" role="OWNER" />);

    expect(await screen.findByText("Kathmandu Traders")).toBeInTheDocument();
    expect(screen.getByText("9801112222")).toBeInTheDocument();
    expect(screen.getByText(/Opening balance/)).toBeInTheDocument();
  });

  it("shows loading and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SupplierDetail id="sup-1" role="OWNER" />);
    expect(screen.getByText(/Loading supplier/i)).toBeInTheDocument();

    mocks.apiGet.mockRejectedValue(new Error("Not found"));
    renderWithClient(<SupplierDetail id="sup-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeInTheDocument());
  });

  it("shows Pay supplier button for OWNER", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(supplier)
      .mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } });

    renderWithClient(<SupplierDetail id="sup-1" role="OWNER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByRole("link", { name: /Pay supplier/i })).toHaveAttribute("href", "/suppliers/sup-1/pay");
  });

  it("hides Pay supplier button for CASHIER", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(supplier)
      .mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } });

    renderWithClient(<SupplierDetail id="sup-1" role="CASHIER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.queryByRole("link", { name: /Pay supplier/i })).not.toBeInTheDocument();
  });

  it("hides payment history for CASHIER", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(supplier)
      .mockResolvedValueOnce({ data: [payment], paging: { next: null, hasMore: false } });

    renderWithClient(<SupplierDetail id="sup-1" role="CASHIER" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.queryByText(/Payment history/)).not.toBeInTheDocument();
  });

  it("shows payment history for OWNER", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(supplier)
      .mockResolvedValueOnce({ data: [payment], paging: { next: null, hasMore: false } });

    renderWithClient(<SupplierDetail id="sup-1" role="OWNER" />);

    await screen.findByText(/Payment history/);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* SupplierForm                                                              */
/* ────────────────────────────────────────────────────────────────────────── */
describe("SupplierForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockReset();
  });

  it("submits a new supplier with opening balance and navigates", async () => {
    mocks.apiPost.mockResolvedValue({ id: "sup-3" });
    renderWithClient(<SupplierForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Name/i), "New Supplier");
    await user.type(screen.getByLabelText(/Contact/i), "9809999999");
    await user.type(screen.getByLabelText(/Opening balance/i), "5000");
    await user.click(screen.getByRole("button", { name: /Create supplier/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/suppliers", {
        name: "New Supplier",
        contact: "9809999999",
        openingBalance: 5000,
      }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/suppliers"));
  });

  it("displays explanation text for positive opening balance", async () => {
    renderWithClient(<SupplierForm />);
    expect(screen.getByText(/Positive = shop already owes this supplier/i)).toBeInTheDocument();
    expect(screen.getByText(/Negative = shop has prepaid this supplier/i)).toBeInTheDocument();
  });

  it("displays server error on failed creation", async () => {
    mocks.apiPost.mockRejectedValue(new Error("Name is required"));
    renderWithClient(<SupplierForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Create supplier/i }));

    await waitFor(() => expect(screen.getByText("Name is required")).toBeInTheDocument());
  });

  it("submits without contact or opening balance", async () => {
    mocks.apiPost.mockResolvedValue({ id: "sup-4" });
    renderWithClient(<SupplierForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Name/i), "Simple Supplier");
    await user.click(screen.getByRole("button", { name: /Create supplier/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/suppliers", { name: "Simple Supplier" }),
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* SupplierPayForm                                                           */
/* ────────────────────────────────────────────────────────────────────────── */
describe("SupplierPayForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("submits a payment and navigates back to supplier detail", async () => {
    mocks.apiGet.mockResolvedValue(supplier);
    mocks.apiPost.mockResolvedValue({ id: "spay-2" });
    renderWithClient(<SupplierPayForm supplierId="sup-1" />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.type(screen.getByLabelText(/Amount/i), "2000");
    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/supplier-payments", {
        supplierId: "sup-1",
        amount: 2000,
      }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/suppliers/sup-1"));
  });

  it("shows current supplier balance", async () => {
    mocks.apiGet.mockResolvedValue(supplier);
    renderWithClient(<SupplierPayForm supplierId="sup-1" />);

    await screen.findByText("Kathmandu Traders");
    expect(screen.getByText(/Current balance/)).toBeInTheDocument();
    expect(screen.getByText(/Shop owes/)).toBeInTheDocument();
  });

  it("displays error on invalid amount", async () => {
    mocks.apiGet.mockResolvedValue(supplier);
    mocks.apiPost.mockRejectedValue(new Error("Amount must be a positive number"));
    renderWithClient(<SupplierPayForm supplierId="sup-1" />);
    const user = userEvent.setup();

    await screen.findByText("Kathmandu Traders");
    await user.type(screen.getByLabelText(/Amount/i), "0");
    await user.click(screen.getByRole("button", { name: /Record payment/i }));

    await waitFor(() => expect(screen.getByText(/Amount must be a positive number/i)).toBeInTheDocument());
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* SupplierPaymentHistory                                                    */
/* ────────────────────────────────────────────────────────────────────────── */
describe("SupplierPaymentHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);
    expect(screen.getByText(/Loading payments/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText("No payments yet")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load"));
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders payment with ACTIVE status", async () => {
    mocks.apiGet.mockResolvedValue({ data: [payment], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);

    await waitFor(() => expect(screen.getByText("ACTIVE")).toBeInTheDocument());
    expect(screen.getByText(/2,000/)).toBeInTheDocument();
  });

  it("renders VOIDED payment with reason", async () => {
    const voidedPayment = { ...payment, status: "VOIDED" as const, voidReason: "Duplicate" };
    mocks.apiGet.mockResolvedValue({ data: [voidedPayment], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);

    await waitFor(() => expect(screen.getByText("VOIDED")).toBeInTheDocument());
    expect(screen.getByText(/Void: Duplicate/)).toBeInTheDocument();
  });

  it("shows Void button for OWNER on ACTIVE payments", async () => {
    mocks.apiGet.mockResolvedValue({ data: [payment], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);

    await waitFor(() => expect(screen.getByText("ACTIVE")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Void/i })).toBeInTheDocument();
  });

  it("hides Void button for CASHIER", async () => {
    mocks.apiGet.mockResolvedValue({ data: [payment], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="CASHIER" />);

    await waitFor(() => expect(screen.getByText("ACTIVE")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Void/i })).not.toBeInTheDocument();
  });

  it("opens and submits void form", async () => {
    mocks.apiGet.mockResolvedValue({ data: [payment], paging: { next: null, hasMore: false } });
    mocks.apiPost.mockResolvedValue({});
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Void/i }));
    expect(screen.getByLabelText(/Void reason/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Void reason/i), "Mistake");
    await user.click(screen.getByRole("button", { name: /Confirm void/i }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/supplier-payments/spay-1/void", { reason: "Mistake" }),
    );
  });

  it("validates void reason is required", async () => {
    mocks.apiGet.mockResolvedValue({ data: [payment], paging: { next: null, hasMore: false } });
    renderWithClient(<SupplierPaymentHistory supplierId="sup-1" role="OWNER" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Void/i }));
    const confirmBtn = screen.getByRole("button", { name: /Confirm void/i });
    expect(confirmBtn).toBeDisabled();
  });
});
