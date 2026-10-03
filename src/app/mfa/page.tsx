import { AuthShell } from "@/components/auth/AuthShell";
import { MfaForm } from "@/components/auth/AuthForms";

export default async function MfaPage(props: { searchParams: Promise<{ next?: string }> }) {
  const sp = await props.searchParams;
  return (
    <AuthShell title="Two-factor verification">
      <MfaForm next={sp.next} />
    </AuthShell>
  );
}
