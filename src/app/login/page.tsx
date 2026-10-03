import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/AuthForms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const sp = await props.searchParams;
  return (
    <AuthShell title="Sign in" subtitle="Access your requests, quotations and messages.">
      <LoginForm next={sp.next} reason={sp.reason} />
    </AuthShell>
  );
}
