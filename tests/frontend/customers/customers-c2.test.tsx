import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomersList } from "@/components/customers/customers-list";
import { CustomerDetail } from "@/components/customers/customer-detail";
import { CustomerForm } from "@/components/customers/customer-form";
import { CustomerPayForm } from "@/components/customers/customer-pay-form";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  usePathname: () => "/customers",
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

const customer = {
  id: "cust-1",
  name: "Ram",
  contact: "9801234567",
  balanceOwed: 500,
  createdAt: "2026-08-10T00:00:00.000Z",
};

const customerPrepaid = {
  id: "cust-2",
  name: "Shyam",
  contact: null,
  balanceOwed: -200,
  createdAt: "2026-08-11T00:00:00.000Z",
};

const payment = {
  id: "pay-1",
  customerId: "cust-1",
  saleId: null,
  amount: 300,
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

describe("CustomersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows loading, empty, and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<CustomersList />);
    expect(screen.getByText(/Loading customers/i)).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<CustomersList />);
    await waitFor(() => expect(screen.getByText("No customers found")).toBeInTheDocument());

    mocks.apiGet.mockRejectedValue(new Error("Failed to load"));
    renderWithClient(<CustomersList />);
    await waitFor(() => expect(screen.getByText(/Failed to load/i)).toBeInTheDocument());
  });

  it("renders customers with balance display", async () => {
    mocks.apiGet.mockResolvedValue({ data: [customer, customerPrepaid], paging: { next: null, hasMore: false } });
    renderWithClient(<CustomersList />);

    expect(await screen.findByText("Ram")).toBeInTheDocument();
    expect(screen.getByText("Shyam")).toBeInTheDocument();
    expect(screen.getByText("9801234567")).toBeInTheDocument();
  });

  it("navigates to customer detail from the list", async () => {
    mocks.apiGet.mockResolvedValue({ data: [customer], paging: { next: null, hasMore: false } });
    renderWithClient(<CustomersList />);

    const link = await screen.findByRole("link", { name: /View Ram/i });
    expect(link).toHaveAttribute("href", "/customers/cust-1");
  });

  it("shows new customer button for all roles", async () => {
    mocks.apiGet.mockResolvedValue({ data: [], paging: { next: null, hasMore: false } });
    renderWithClient(<CustomersList />);
    expect(await screen.findByRole("link", { name: /New customer/i })).toBeInTheDocument();
  });
});

describe("CustomerDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("renders customer info and balance", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce({ data: [payment], paging: { next: null, hasMore: false } });

    renderWithClient(<CustomerDetail id="cust-1" role="OWNER" />);

    expect(await screen.findByText("Ram")).toBeInTheDocument();
    expect(screen.getByText("9801234567")).toBeInTheDocument();
  });

  it("shows loading and error states", async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));
    renderWithClient(<CustomerDetail id="cust-1" role="OWNER" />);
    expect(screen.getByText(/Loading customer/i)).toBeInTheDocument();

    mocks.apiGet.mockRejectedValue(new Error("Not found"));
    renderWithClient(<CustomerDetail id="cust-1" role="OWNER" />);
    await waitFor(() => expect(screen.getByText(/Not found/i)).toBeInTheDocument());
  });
});

describe("CustomerForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockReset();
  });

  it("submits a new customer and navigates back", async () => {
    mocks.apiPost.mockResolvedValue(customer);
    renderWithClient(<CustomerForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Name/i), "Ram");
    await user.type(screen.getByLabelText(/Contact/i), "9801234567");
    await user.click(screen.getByRole("button", { name: /Create customer/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/customers", expect.objectContaining({ name: "Ram" })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/customers"));
  });

  it("displays server error on failed creation", async () => {
    mocks.apiPost.mockRejectedValue(new Error("Name is required"));
    renderWithClient(<CustomerForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Create customer/i }));

    await waitFor(() => expect(screen.getByText("Name is required")).toBeInTheDocument());
  });
});

describe("CustomerPayForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("submits a payment and navigates back", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } });
    mocks.apiPost.mockResolvedValue({ id: "pay-1" });
    renderWithClient(<CustomerPayForm customerId="cust-1" />);
    const user = userEvent.setup();

    await screen.findByText("Ram");
    await user.type(screen.getByLabelText(/Amount/i), "300");
    await user.click(screen.getByRole("button", { name: /Receive payment/i }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/api/customer-payments", expect.objectContaining({ amount: 300 })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/customers/cust-1"));
  });

  it("displays error on invalid amount", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce({ data: [], paging: { next: null, hasMore: false } });
    mocks.apiPost.mockRejectedValue(new Error("Amount must be a positive number"));
    renderWithClient(<CustomerPayForm customerId="cust-1" />);
    const user = userEvent.setup();

    await screen.findByText("Ram");
    await user.type(screen.getByLabelText(/Amount/i), "0");
    await user.click(screen.getByRole("button", { name: /Receive payment/i }));

    await waitFor(() => expect(screen.getByText(/Amount must be a positive number/i)).toBeInTheDocument());
  });
});
