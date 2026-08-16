// Session-gated workspace shell (D22.5). This layout is the authoritative UI
// gate: every workspace route redirects to /sign-in until a valid DB-backed
// session exists (the proxy only checks cookie presence, D9.8).

import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await requireSession();

  return <AppShell user={session.user}>{children}</AppShell>;
}
