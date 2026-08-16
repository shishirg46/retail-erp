import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { requireSession } from "@/lib/auth/session";

// Settings — Phase A (plan §12.15). Profile + timezone are display-only from
// the session; the OWNER wallet balance tile arrives with the reports screens.
export default async function SettingsPage() {
  const session = await requireSession();
  const timezone = process.env.ERP_TIMEZONE || DEFAULT_TIMEZONE;

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Signed in session</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">Name</p>
            <p className="font-medium">{session.user.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Username</p>
            <p className="font-medium">@{session.user.username}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Role</p>
            <p className="font-medium">{session.user.role}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shop</CardTitle>
          <CardDescription>Display-only — configuration stays in .env</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">Timezone (D10)</p>
            <p className="font-medium">{timezone}</p>
          </div>
          <Separator />
          <div>
            <p className="text-muted-foreground">Wallet balance</p>
            <p className="font-medium">
              Unavailable in Phase A — arrives with the wallet report.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
