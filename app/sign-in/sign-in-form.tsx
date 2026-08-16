"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { signInSchema, type SignInInput } from "@/lib/validate/sign-in";

// Username + password sign-in (D9, plan §10). Errors are the API's own
// `{ message }` shown inline — the backend rate-limits failures per IP (F-08)
// and its message is surfaced verbatim. Success toasts are the only toast here
// (D21.8: errors stay inline).
export function SignInForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { username: "", password: "" },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(values: SignInInput) {
    setServerError(null);
    const { error } = await authClient.signIn.username({
      username: values.username,
      password: values.password,
    });

    if (error) {
      setServerError(error.message ?? "Sign in failed. Check your username and password.");
      return;
    }

    toast.success("Signed in");
    router.push("/");
    router.refresh();
  }

  return (
    <div className="w-full">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="your username"
                    className="h-11 text-base"
                    data-testid="sign-in-username"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-11 pr-11 text-base"
                      data-testid="sign-in-password"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-5" aria-hidden />
                    ) : (
                      <Eye className="size-5" aria-hidden />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {serverError ? (
            <p
              role="alert"
              data-testid="sign-in-error"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
            data-testid="sign-in-submit"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
