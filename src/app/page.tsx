import { Conversation } from "@/components/chat/Conversation";
import { getCurrentUser } from "@/server/auth/session";

export default async function Home(props: { searchParams: Promise<{ c?: string; submit?: string }> }) {
  const sp = await props.searchParams;
  const session = await getCurrentUser();
  const resumeId = sp.c && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : undefined;
  return (
    <Conversation
      key={resumeId ?? "home"}
      signedIn={Boolean(session)}
      orgKind={session?.org.kind ?? null}
      resumeId={resumeId}
      autoSubmit={sp.submit === "1"}
    />
  );
}
