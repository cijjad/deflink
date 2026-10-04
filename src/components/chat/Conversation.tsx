"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, AssistantReply, ConversationState } from "@/core/conversation/types";
import { Icon } from "@/components/ui/Icon";
import { Block, type BlockHandlers } from "./blocks";

type Entry =
  | { id: string; role: "user"; text: string; file?: boolean }
  | { id: string; role: "assistant"; reply: AssistantReply; state?: ConversationState; ready?: boolean };

const EXAMPLES = [
  "I need 25 hydraulic pumps",
  "Find Part No. ABC-12345",
  "Find suppliers for this OEM",
  "I need 100 industrial filters",
  "Find this item in Europe",
  "I need this delivered to Pakistan",
];

const STORE_KEY = "dl_conversation";
let entryId = 0;
const nextId = () => `e${++entryId}`;

interface Props {
  signedIn: boolean;
  orgKind: "BUYER" | "SUPPLIER" | "PLATFORM" | null;
  resumeId?: string;
  autoSubmit?: boolean;
}

export function Conversation({ signedIn, orgKind, resumeId, autoSubmit }: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(resumeId);
  const [input, setInput] = useState("");
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exampleIdx, setExampleIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const submittedOnce = useRef(false);

  const started = entries.length > 0;
  const lastAssistant = [...entries].reverse().find((e) => e.role === "assistant") as Extract<Entry, { role: "assistant" }> | undefined;

  /* ---------------------------------------------------------- lifecycle */

  useEffect(() => {
    const t = setInterval(() => setExampleIdx((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  const hydrate = useCallback(async (id: string) => {
    const res = await fetch(`/api/chat/${id}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data: { id: string; state: ConversationState; messages: { role: string; content: Record<string, unknown> }[] } = await res.json();
    const restored: Entry[] = data.messages.map((m) =>
      m.role === "assistant"
        ? { id: nextId(), role: "assistant", reply: m.content as unknown as AssistantReply }
        : { id: nextId(), role: "user", text: describeUserContent(m.content) },
    );
    const last = [...restored].reverse().find((e) => e.role === "assistant") as Extract<Entry, { role: "assistant" }> | undefined;
    if (last) {
      last.state = data.state;
      last.ready = !data.state.rfqId && isReady(data.state);
    }
    if (data.state.rfqId) {
      restored.push({
        id: nextId(),
        role: "assistant",
        reply: {
          blocks: [{ type: "text", text: `This requirement was submitted as ${data.state.rfqRef ?? "an RFQ"}.` }],
          actions: [
            { type: "VIEW_RFQ", label: "Track request", primary: true, value: data.state.rfqId },
            { type: "NEW_SEARCH", label: "New request" },
          ],
        },
      });
    }
    setEntries(restored);
    setConversationId(data.id);
    return true;
  }, []);

  useEffect(() => {
    const id = resumeId ?? safeSession(() => sessionStorage.getItem(STORE_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted conversation
    if (id) hydrate(id).then((ok) => !ok && safeSession(() => sessionStorage.removeItem(STORE_KEY)));
  }, [resumeId, hydrate]);

  useEffect(() => {
    if (conversationId) safeSession(() => sessionStorage.setItem(STORE_KEY, conversationId));
  }, [conversationId]);

  useEffect(() => {
    if (started) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, started]);

  /* ------------------------------------------------------------ actions */

  const pushReply = useCallback((data: { conversationId: string; reply: AssistantReply; state?: ConversationState; ready?: boolean }) => {
    if (data.conversationId) setConversationId(data.conversationId);
    setEntries((e) => [...e, { id: nextId(), role: "assistant", reply: data.reply, state: data.state, ready: data.ready }]);
  }, []);

  const call = useCallback(
    async (body: { text?: string; action?: { type: string; value?: string } }) => {
      setBusy(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, ...body }),
        });
        const data = await res.json();
        if (!res.ok) {
          pushReply({ conversationId: conversationId ?? "", reply: errorReply(data?.error?.message) });
          return;
        }
        pushReply(data);
      } catch {
        pushReply({ conversationId: conversationId ?? "", reply: errorReply("You appear to be offline. Please try again.") });
      } finally {
        setBusy(false);
        setPlaceholder(null);
      }
    },
    [conversationId, pushReply],
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setEntries((e) => [...e, { id: nextId(), role: "user", text: t }]);
      setInput("");
      call({ text: t });
    },
    [busy, call],
  );

  const submitRfq = useCallback(async () => {
    if (!conversationId) return;
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/?c=${conversationId}&submit=1`)}&reason=quote`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/rfqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) });
      const data = await res.json();
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/?c=${conversationId}&submit=1`)}&reason=quote`);
        return;
      }
      if (res.status === 422) {
        setBusy(false);
        await call({ action: { type: "GET_QUOTES" } });
        return;
      }
      if (!res.ok) {
        pushReply({ conversationId, reply: errorReply(data?.error?.message) });
        return;
      }
      const review = data.status === "COMPLIANCE_REVIEW";
      safeSession(() => sessionStorage.removeItem(STORE_KEY));
      pushReply({
        conversationId,
        reply: {
          blocks: [
            {
              type: "text",
              text: review
                ? `${data.ref} created. It needs a compliance review before it is sent to suppliers — we'll notify you.`
                : data.recipients
                  ? `${data.ref} created and sent to ${data.recipients} matched supplier${data.recipients === 1 ? "" : "s"}. You'll be notified as quotations arrive.`
                  : `${data.ref} created. No verified supplier matched automatically yet — our sourcing team has been notified.`,
            },
          ],
          actions: [
            { type: "VIEW_RFQ", label: "Track request", primary: true, value: data.rfqId },
            { type: "NEW_SEARCH", label: "New request" },
          ],
        },
      });
    } finally {
      setBusy(false);
    }
  }, [conversationId, signedIn, router, call, pushReply]);

  useEffect(() => {
    if (autoSubmit && signedIn && conversationId && !submittedOnce.current && lastAssistant?.ready) {
      submittedOnce.current = true;
      // Clean the URL without remounting (a remount would drop the confirmation).
      window.history.replaceState(null, "", "/");
      submitRfq();
    }
  }, [autoSubmit, signedIn, conversationId, lastAssistant, submitRfq]);

  const focusInput = (hint?: string, prefill?: string) => {
    setPlaceholder(hint ?? null);
    if (prefill !== undefined) setInput(prefill);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const reset = () => {
    safeSession(() => sessionStorage.removeItem(STORE_KEY));
    setEntries([]);
    setConversationId(undefined);
    setInput("");
    setPlaceholder(null);
  };

  const onAction = (a: Pick<Action, "type" | "value" | "hint">, label?: string) => {
    switch (a.type) {
      case "GET_QUOTES":
        if (lastAssistant?.ready) return submitRfq();
        return act("GET_QUOTES", undefined, label);
      case "ENTER_QUANTITY":
        return focusInput("How many? e.g. 25 units, two dozen, around 50");
      case "ADD_DESTINATION":
        return focusInput("City and country, e.g. Islamabad, Pakistan");
      case "PART_NUMBER":
        return focusInput("Type the part number", "Part number: ");
      case "OEM":
        return focusInput("Type the OEM / manufacturer", "OEM: ");
      case "ASK_ANOTHER":
        return focusInput("Ask anything — who makes it, availability, alternatives…");
      case "UPLOAD":
        return fileRef.current?.click();
      case "NEW_SEARCH":
        return reset();
      case "VIEW_RFQ":
        return router.push(`/requests/${a.value}`);
      case "EDIT": {
        document.querySelector<HTMLButtonElement>('[data-testid="edit-requirement"], [data-testid="edit-lines"]')?.click();
        return;
      }
      default:
        return act(a.type, a.value, label);
    }
  };

  const act = (type: string, value?: string, label?: string) => {
    if (busy) return;
    if (label) setEntries((e) => [...e, { id: nextId(), role: "user", text: label }]);
    call({ action: { type, value } });
  };

  const patch = async (body: object) => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/${conversationId}/requirement`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) pushReply({ conversationId, reply: errorReply(data?.error?.message) });
      else pushReply(data);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setEntries((e) => [...e, { id: nextId(), role: "user", text: file.name, file: true }]);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (conversationId) form.append("conversationId", conversationId);
      const res = await fetch("/api/chat/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) pushReply({ conversationId: conversationId ?? "", reply: errorReply(data?.error?.message) });
      else pushReply(data);
    } catch {
      pushReply({ conversationId: conversationId ?? "", reply: errorReply("Upload failed. Please try again.") });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* -------------------------------------------------------------- render */

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className={`flex items-end gap-2 rounded-2xl border border-graphite-200 bg-white p-2 shadow-sm focus-within:border-accent-500 focus-within:ring-4 focus-within:ring-accent-100 ${started ? "" : "sm:p-3"}`}
    >
      <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost !min-h-11 !px-2.5" aria-label="Upload a requirement file" title="Upload Excel / CSV">
        <Icon name="upload" />
      </button>
      <textarea
        ref={inputRef}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(input);
          }
        }}
        placeholder={placeholder ?? (started ? "Reply, or ask anything…" : "Part number, OEM or item…")}
        aria-label="What do you need?"
        data-testid="chat-input"
        className={`max-h-40 min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-base text-graphite-900 placeholder:text-graphite-400 focus:outline-none ${started ? "" : "sm:text-lg"}`}
      />
      <button type="submit" className="btn-primary !min-h-11 !px-4" disabled={busy || !input.trim()} aria-label="Send" data-testid="send">
        <span className="hidden sm:inline">Send</span>
        <Icon name="send" className="h-4 w-4" />
      </button>
    </form>
  );

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      className="hidden"
      accept=".xlsx,.csv,.pdf,.docx,.png,.jpg,.jpeg,.webp"
      data-testid="file-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
      }}
    />
  );

  if (!started) {
    return (
      <div className="relative">
        {fileInput}
        <section className="relative overflow-hidden bg-navy-900 text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative mx-auto max-w-3xl px-4 pb-24 pt-14 text-center sm:pb-28 sm:pt-20">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Global procurement &amp; sourcing</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">What do you need?</h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/75 sm:text-lg">Tell us what you&apos;re looking for. We&apos;ll help you find it.</p>
          </div>
        </section>
        <div className="relative mx-auto -mt-16 max-w-3xl px-4">
          {composer}
          <p className="mt-3 h-5 text-center text-sm text-graphite-500" aria-live="polite">
            Try: <button className="font-medium text-navy-700 hover:underline" onClick={() => send(EXAMPLES[exampleIdx])}>&ldquo;{EXAMPLES[exampleIdx]}&rdquo;</button>
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <QuickAction icon="search" label="Find something" onClick={() => focusInput("Part number, OEM or description", "Find ")} />
            <QuickAction icon="quotes" label="Get a quote" onClick={() => focusInput("What and how many? e.g. I need 25 units of ABC123", "I need ")} />
            <QuickAction icon="upload" label="Upload requirement" onClick={() => fileRef.current?.click()} />
            {orgKind === "SUPPLIER" ? (
              <QuickAction icon="requests" label="Incoming RFQs" href="/supplier" />
            ) : (
              <QuickAction icon="requests" label="My requests" href={signedIn ? "/requests" : "/login?next=/requests"} />
            )}
          </div>
          <div className="mx-auto mt-14 grid max-w-3xl gap-6 pb-6 text-sm text-graphite-700 sm:grid-cols-3">
            <Pillar icon="globe" title="Global sourcing" text="OEMs, authorized distributors and stockists — matched to your exact part and destination." />
            <Pillar icon="shield" title="Verified, not guessed" text="Every price, stock level and badge shows where it came from. Nothing is invented." />
            <Pillar icon="check" title="Compliance built in" text="Controlled items are routed to human compliance review before any supplier sees them." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem-5rem)] max-w-3xl flex-col px-4 md:min-h-[calc(100dvh-3.5rem)]">
      {fileInput}
      <div className="flex items-center justify-between py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-graphite-500">Procurement assistant</span>
        <button onClick={reset} className="text-sm font-semibold text-accent-600" data-testid="new-request">
          New request
        </button>
      </div>
      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {entries.map((e) =>
          e.role === "user" ? (
            <div key={e.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-navy-800 px-4 py-2.5 text-[15px] text-white" data-testid="user-message">
                {e.file && <Icon name="upload" className="mr-1 inline h-4 w-4" />}
                {e.text}
              </div>
            </div>
          ) : (
            <AssistantMessage key={e.id} entry={e} latest={e === lastAssistant} busy={busy} onAction={onAction} patch={patch} act={act} />
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-graphite-500" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" /> Working on it…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-graphite-50 via-graphite-50 to-graphite-50/0 pb-3 pt-4 md:bottom-0 md:pb-6">{composer}</div>
    </div>
  );
}

function AssistantMessage({
  entry,
  latest,
  busy,
  onAction,
  patch,
  act,
}: {
  entry: Extract<Entry, { role: "assistant" }>;
  latest: boolean;
  busy: boolean;
  onAction: (a: Action, label?: string) => void;
  patch: (b: object) => Promise<void>;
  act: (t: string, v?: string, label?: string) => void;
}) {
  const h: BlockHandlers = { act: (t, v) => act(t, v), patch, interactive: latest, busy };
  return (
    <div className="flex gap-3" data-testid="assistant-message">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">DL</div>
      <div className="min-w-0 flex-1 space-y-3">
        {entry.reply.blocks.map((b, i) => (
          <Block key={i} block={b} h={h} />
        ))}
        {latest && entry.reply.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1" data-testid="actions">
            {entry.reply.actions.map((a, i) => (
              <button
                key={`${a.type}-${a.value ?? i}`}
                className={a.primary ? "btn-primary" : "btn-secondary"}
                disabled={busy}
                onClick={() => onAction(a, ["SET_CONDITION", "DONT_KNOW", "CHOOSE_CANDIDATE", "NONE_OF_THESE", "GET_QUOTE", "SKIP"].includes(a.type) ? a.label : undefined)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick, href }: { icon: string; label: string; onClick?: () => void; href?: string }) {
  const cls = "card flex min-h-20 flex-col items-start justify-between gap-2 p-3 text-left text-sm font-semibold text-graphite-900 transition-colors hover:border-navy-700/40 hover:bg-white sm:p-4";
  const inner = (
    <>
      <Icon name={icon} className="h-5 w-5 text-accent-600" />
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Pillar({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div>
      <Icon name={icon} className="mb-2 h-5 w-5 text-navy-700" />
      <div className="font-semibold text-graphite-900">{title}</div>
      <p className="mt-1 text-graphite-500">{text}</p>
    </div>
  );
}

function errorReply(message?: string): AssistantReply {
  return { blocks: [{ type: "notice", tone: "danger", text: message ?? "Something went wrong. Please try again." }], actions: [] };
}

function describeUserContent(c: Record<string, unknown>): string {
  if (typeof c.text === "string") return c.text;
  if (typeof c.upload === "string") return c.upload;
  if (c.edit) return "Edited the requirement";
  const action = c.action as { type?: string; value?: string } | undefined;
  if (action?.type === "SET_CONDITION") return humanCondition(action.value);
  return action?.type ? action.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase()) : "";
}

function humanCondition(v?: string) {
  return v === "NEW" ? "New" : v === "ANY" ? "Any condition" : v === "NEW_OR_APPROVED_ALTERNATIVE" ? "New or approved alternative" : (v ?? "");
}

function isReady(s: ConversationState) {
  return s.lines.length > 0 && s.lines.every((l) => l.quantity) && Boolean(s.condition) && Boolean(s.destination);
}

function safeSession<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
