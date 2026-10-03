import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/AuthForms";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage(props: { searchParams: Promise<{ next?: string }> }) {
  const sp = await props.searchParams;
  return (
    <AuthShell title="Create your account" subtitle="Takes under a minute. Further verification only when it's needed.">
      <RegisterForm next={sp.next} />
    </AuthShell>
  );
}
