import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { SignInForm } from "@/app/sign-in/sign-in-form";

const push = vi.fn();
const refresh = vi.fn();
const signIn = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { username: (...args: unknown[]) => signIn(...args) } },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("SignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the username and password fields and the submit button", () => {
    render(<SignInForm />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows inline validation errors before calling the server", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Username"), "ram");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText(/8 characters/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("surfaces the API error message inline on a failed sign-in", async () => {
    signIn.mockResolvedValue({ error: { message: "Too many attempts" } });

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Username"), "ram");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects to / after a successful sign-in", async () => {
    signIn.mockResolvedValue({ error: null });

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Username"), "ram");
    await user.type(screen.getByLabelText("Password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ username: "ram", password: "secret123" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });
});
