/**
 * Interactive preview of DefLink. Reuses the production UI components and the real
 * conversation engine; data comes from preview/demo-service.ts instead of the server API.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Block, type BlockHandlers } from "@/components/chat/blocks";
import { Logo } from "@/components/layout/Logo";
import { DemoBadge, IdentificationBadge, RfqStatus, VerificationBadges } from "@/components/ui/Badges";
import { Icon } from "@/components/ui/Icon";
import type { Action, AssistantReply, Condition, ConversationState, RequirementLine } from "@/core/conversation/types";
import { AVAILABILITY_LABEL, money, num } from "@/lib/format";
import ExcelSample from "./sample-rows.json";
import {
  addRows,
  CONDITION_LABEL,
  countryName,
  destinationLabel,
  editLines,
  emptyState,
  formatQuantity,
  listingFor,
  matchSuppliers,
  sendAction,
  sendText,
  supplierByKey,
  type Turn,
} from "./demo-service";

/* ------------------------------------------------------------------ model */

type Role = "buyer" | "supplier";
type Screen = "home" | "requests" | "rfq" | "quotes" | "messages" | "account" | "inbox" | "srfq";
type Entry = { id: number; role: "user"; text: string } | { id: number; role: "assistant"; reply: AssistantReply; ready?: boolean };

interface QuoteLine {
  key: string;
  unitPrice: number;
  quantity: number;
  availability: string;
  leadTimeDays: number;
  condition: Condition;
  certification: string;
}
interface Quote {
  supplier: string;
  revision: number;
  lines: QuoteLine[];
  incoterm: string;
  validUntil: string;
  paymentTerms: string;
  note?: string;
  shortlisted?: boolean;
  history: { revision: number; unitPrice: number; leadTimeDays: number }[];
  simulated?: boolean;
}
interface Msg {
  from: "buyer" | "supplier";
  body: string;
  at: string;
}
interface Rfq {
  id: string;
  ref: string;
  lines: RequirementLine[];
  condition: Condition;
  destination: string;
  destinationCountry?: string;
  createdAt: string;
  status: "OPEN" | "QUOTED" | "COMPLIANCE_REVIEW";
  recipients: { key: string; name: string; country: string; reasons: string[]; status: "SENT" | "VIEWED" | "QUOTED" }[];
  quotes: Quote[];
  threads: Record<string, Msg[]>;
}

const SUPPLIER_ME = "alpha";
const today = "03 Oct 2026";
const validDate = "2026-11-02";
let entryId = 0;
let refNo = 10000;

/* -------------------------------------------------------------------- app */

function App() {
  const [role, setRole] = useState<Role>("buyer");
  const [screen, setScreen] = useState<Screen>("home");
  const [signedIn, setSignedIn] = useState(false);
  const [askSignIn, setAskSignIn] = useState(false);
  const [state, setState] = useState<ConversationState>(emptyState());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [openRfq, setOpenRfq] = useState<string | null>(null);
  const [unread, setUnread] = useState({ buyer: 0, supplier: 0 });
  const [toast, setToast] = useState<string | null>(null);

  const go = (s: Screen, id?: string) => {
    if (id) setOpenRfq(id);
    setScreen(s);
    window.scrollTo({ top: 0 });
  };
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 3200);
  };

  const pushTurn = (t: Turn) => {
    setState(t.state);
    setEntries((e) => [...e, { id: ++entryId, role: "assistant", reply: t.reply, ready: t.ready }]);
  };
  const say = (text: string) => {
    setEntries((e) => [...e, { id: ++entryId, role: "user", text }]);
    pushTurn(sendText(state, text));
  };
  const act = (type: string, value?: string, label?: string) => {
    if (label) setEntries((e) => [...e, { id: ++entryId, role: "user", text: label }]);
    pushTurn(sendAction(state, { type: type as Action["type"], value }));
  };
  const reset = () => {
    setState(emptyState());
    setEntries([]);
  };

  function createRfq() {
    const { suppliers, controlled } = matchSuppliers(state);
    const id = `r${++refNo}`;
    const rfq: Rfq = {
      id,
      ref: `RFQ-${refNo}`,
      lines: structuredClone(state.lines),
      condition: state.condition ?? "NEW",
      destination: destinationLabel(state.destination),
      destinationCountry: state.destination?.country,
      createdAt: today,
      status: controlled ? "COMPLIANCE_REVIEW" : "OPEN",
      recipients: controlled ? [] : suppliers.map((s) => ({ ...s, status: "SENT" })),
      quotes: [],
      threads: {},
    };
    setRfqs((r) => [rfq, ...r]);
    setState({ ...state, rfqId: id, rfqRef: rfq.ref, awaiting: undefined });
    setEntries((e) => [
      ...e,
      {
        id: ++entryId,
        role: "assistant",
        reply: {
          blocks: [
            {
              type: "text",
              text: controlled
                ? `${rfq.ref} created. It needs a compliance review before it is sent to suppliers — we'll notify you.`
                : `${rfq.ref} created and sent to ${suppliers.length} matched supplier${suppliers.length === 1 ? "" : "s"}. You'll be notified as quotations arrive.`,
            },
          ],
          actions: [
            { type: "VIEW_RFQ", label: "Track request", primary: true, value: id },
            { type: "NEW_SEARCH", label: "New request" },
          ],
        },
      },
    ]);
    if (!controlled) {
      setUnread((u) => ({ ...u, supplier: u.supplier + (suppliers.some((s) => s.key === SUPPLIER_ME) ? 1 : 0) }));
      simulateQuote(rfq);
    }
  }

  /** A second verified supplier answers after a moment, using its own listed price (DEMO). */
  function simulateQuote(rfq: Rfq) {
    const other = rfq.recipients.find((r) => r.key !== SUPPLIER_ME && rfq.lines.some((l) => priceOf(r.key, l)));
    if (!other) return;
    setTimeout(() => {
      const lines = rfq.lines
        .filter((l) => priceOf(other.key, l))
        .map((l) => ({ key: l.key, unitPrice: priceOf(other.key, l)!, quantity: l.quantity ?? 1, availability: (listingFor(other.key, l.productId)?.qty ?? 0) > 0 ? "IN_STOCK" : "FACTORY_ORDER", leadTimeDays: listingFor(other.key, l.productId)?.lead ?? 14, condition: "NEW" as Condition, certification: listingFor(other.key, l.productId)?.cert ?? "" }));
      setRfqs((all) =>
        all.map((r) =>
          r.id !== rfq.id
            ? r
            : {
                ...r,
                status: "QUOTED",
                recipients: r.recipients.map((x) => (x.key === other.key ? { ...x, status: "QUOTED" } : x)),
                quotes: [...r.quotes, { supplier: other.key, revision: 1, lines, incoterm: "DAP", validUntil: validDate, paymentTerms: "30 days after delivery", history: [], simulated: true }],
              },
        ),
      );
      setUnread((u) => ({ ...u, buyer: u.buyer + 1 }));
      flash(`Quotation received from ${other.name} for ${rfq.ref}`);
    }, 2500);
  }

  function submitQuote(rfqId: string, q: Omit<Quote, "supplier" | "revision" | "history">) {
    setRfqs((all) =>
      all.map((r) => {
        if (r.id !== rfqId) return r;
        const prev = r.quotes.find((x) => x.supplier === SUPPLIER_ME);
        const revision = (prev?.revision ?? 0) + 1;
        const quote: Quote = { ...q, supplier: SUPPLIER_ME, revision, shortlisted: prev?.shortlisted, history: prev ? [...prev.history, { revision: prev.revision, unitPrice: prev.lines[0]?.unitPrice, leadTimeDays: prev.lines[0]?.leadTimeDays }] : [] };
        const threads = prev ? { ...r.threads, [SUPPLIER_ME]: [...(r.threads[SUPPLIER_ME] ?? []), { from: "supplier" as const, body: `Updated quotation (revision ${revision}): ${q.note}`, at: "now" }] } : r.threads;
        return { ...r, status: "QUOTED", threads, quotes: [...r.quotes.filter((x) => x.supplier !== SUPPLIER_ME), quote], recipients: r.recipients.map((x) => (x.key === SUPPLIER_ME ? { ...x, status: "QUOTED" } : x)) };
      }),
    );
    setUnread((u) => ({ ...u, buyer: u.buyer + 1 }));
  }

  function postMessage(rfqId: string, supplier: string, from: "buyer" | "supplier", body: string) {
    setRfqs((all) => all.map((r) => (r.id !== rfqId ? r : { ...r, threads: { ...r.threads, [supplier]: [...(r.threads[supplier] ?? []), { from, body, at: "now" }] } })));
    setUnread((u) => (from === "buyer" ? { ...u, supplier: u.supplier + 1 } : { ...u, buyer: u.buyer + 1 }));
  }

  const switchRole = (r: Role) => {
    setRole(r);
    go(r === "buyer" ? "home" : "inbox");
  };

  const nav: [Screen, string, string][] =
    role === "buyer"
      ? [
          ["home", "Home", "home"],
          ["requests", "Requests", "requests"],
          ["quotes", "Quotes", "quotes"],
          ["messages", "Messages", "messages"],
          ["account", "Account", "account"],
        ]
      : [
          ["inbox", "Home", "home"],
          ["inbox", "Requests", "requests"],
          ["inbox", "Quotes", "quotes"],
          ["messages", "Messages", "messages"],
          ["account", "Account", "account"],
        ];
  const rfq = rfqs.find((r) => r.id === openRfq);
  const count = unread[role];

  return (
    <div className="min-h-dvh">
      <div className="bg-warn-50 px-4 py-2 text-center text-xs text-warn-600">
        <strong>Interactive preview · DEMO data.</strong> All companies, part numbers, stock and prices are fictional. Nothing leaves your browser.
      </div>
      <header className="sticky top-0 z-30 bg-navy-900 text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <button onClick={() => go(role === "buyer" ? "home" : "inbox")} aria-label="DefLink home">
            <Logo />
          </button>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.slice(0, 4).map(([s, label], i) => (
              <button key={label + i} onClick={() => go(s)} className={`rounded-md px-3 py-2 text-sm font-medium ${screen === s && i < 2 ? "bg-white/10 text-white" : "text-white/70 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-white/10 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="View as">
              {(["buyer", "supplier"] as Role[]).map((r) => (
                <button key={r} role="radio" aria-checked={role === r} onClick={() => switchRole(r)} className={`rounded-md px-2.5 py-1.5 ${role === r ? "bg-white text-navy-900" : "text-white/75"}`}>
                  {r === "buyer" ? "Buyer" : "Supplier"}
                </button>
              ))}
            </div>
            <button className="relative flex h-10 w-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/10" aria-label="Notifications" onClick={() => setUnread((u) => ({ ...u, [role]: 0 }))}>
              <Icon name="bell" />
              {count > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{count}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="pb-24 md:pb-10">
        {role === "buyer" && screen === "home" && (
          <Chat
            entries={entries}
            state={state}
            say={say}
            act={act}
            reset={reset}
            patch={(b) => pushTurn(editLines(state, (b.lines as never) ?? [], { destination: b.destination as string | undefined, condition: b.condition as Condition | undefined }))}
            upload={() => {
              setEntries((e) => [...e, { id: ++entryId, role: "user", text: "requirement.xlsx (20 rows, sample)" }]);
              pushTurn(addRows(state, ExcelSample));
            }}
            getQuotes={() => (signedIn ? createRfq() : setAskSignIn(true))}
            openRfq={(id) => go("rfq", id)}
          />
        )}
        {role === "buyer" && screen === "requests" && <Requests rfqs={rfqs} open={(id) => go("rfq", id)} newRequest={() => go("home")} />}
        {role === "buyer" && screen === "rfq" && rfq && (
          <BuyerRfq rfq={rfq} back={() => go("requests")} send={(s, b) => postMessage(rfq.id, s, "buyer", b)} shortlist={(s) => setRfqs((all) => all.map((r) => (r.id !== rfq.id ? r : { ...r, quotes: r.quotes.map((q) => (q.supplier === s ? { ...q, shortlisted: !q.shortlisted } : q)) })))} />
        )}
        {role === "buyer" && screen === "quotes" && <QuotesList rfqs={rfqs} open={(id) => go("rfq", id)} />}
        {screen === "messages" && <Messages rfqs={rfqs} role={role} open={(id) => go(role === "buyer" ? "rfq" : "srfq", id)} />}
        {screen === "account" && <Account role={role} signedIn={signedIn || role === "supplier"} />}
        {role === "supplier" && screen === "inbox" && <Inbox rfqs={rfqs.filter((r) => r.recipients.some((x) => x.key === SUPPLIER_ME))} open={(id) => {
          setRfqs((all) => all.map((r) => (r.id !== id ? r : { ...r, recipients: r.recipients.map((x) => (x.key === SUPPLIER_ME && x.status === "SENT" ? { ...x, status: "VIEWED" } : x)) })));
          go("srfq", id);
        }} />}
        {role === "supplier" && screen === "srfq" && rfq && (
          <SupplierRfq
            rfq={rfq}
            back={() => go("inbox")}
            submit={(q) => {
              submitQuote(rfq.id, q);
              flash(rfq.quotes.some((x) => x.supplier === SUPPLIER_ME) ? "Revision submitted. The buyer has been notified." : "Quotation submitted. The buyer has been notified.");
            }}
            send={(b) => postMessage(rfq.id, SUPPLIER_ME, "supplier", b)}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-graphite-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {nav.map(([s, label, icon], i) => {
            const active = (screen === s && (role === "buyer" || i === 0 || s !== "inbox")) || (screen === "rfq" && s === "requests") || (screen === "srfq" && i === 0);
            return (
              <li key={label}>
                <button onClick={() => go(s)} className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-navy-800" : "text-graphite-500"}`}>
                  <Icon name={icon} className="h-5 w-5" />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {askSignIn && (
        <SignInSheet
          close={() => setAskSignIn(false)}
          done={() => {
            setSignedIn(true);
            setAskSignIn(false);
            createRfq();
          }}
        />
      )}
      {toast && (
        <div className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl bg-navy-900 px-4 py-3 text-sm text-white shadow-xl md:bottom-6" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function priceOf(supplier: string, l: RequirementLine) {
  const p = listingFor(supplier, l.productId)?.price;
  return p === undefined ? undefined : Array.isArray(p) ? p[1] : p;
}

/* ------------------------------------------------------------------- chat */

const EXAMPLES = ["I need 25 units of Part ABC123", "I need 50 bearings, 20 filters and 10 pumps", "Find HP-4521", "I need 100 filters delivered to Islamabad", "Find ABC123 in Europe"];

function Chat(p: {
  entries: Entry[];
  state: ConversationState;
  say: (t: string) => void;
  act: (t: string, v?: string, l?: string) => void;
  reset: () => void;
  patch: (b: Record<string, unknown>) => void;
  upload: () => void;
  getQuotes: () => void;
  openRfq: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [ex, setEx] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const started = p.entries.length > 0;
  const last = [...p.entries].reverse().find((e) => e.role === "assistant") as Extract<Entry, { role: "assistant" }> | undefined;

  useEffect(() => {
    const t = setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (started) end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [p.entries.length, started]);

  const send = (t: string) => {
    if (!t.trim()) return;
    p.say(t.trim());
    setInput("");
    setHint(null);
  };
  const focus = (h: string, prefill?: string) => {
    setHint(h);
    if (prefill !== undefined) setInput(prefill);
    requestAnimationFrame(() => ref.current?.focus());
  };
  const onAction = (a: Action) => {
    const labelled = ["SET_CONDITION", "DONT_KNOW", "CHOOSE_CANDIDATE", "NONE_OF_THESE", "GET_QUOTE", "SKIP"].includes(a.type) ? a.label : undefined;
    switch (a.type) {
      case "GET_QUOTES":
        return last?.ready ? p.getQuotes() : p.act("GET_QUOTES");
      case "ENTER_QUANTITY":
        return focus("How many? e.g. 25 units, two dozen, around 50");
      case "ADD_DESTINATION":
        return focus("City and country, e.g. Islamabad, Pakistan");
      case "PART_NUMBER":
        return focus("Type the part number", "Part number: ");
      case "OEM":
        return focus("Type the OEM / manufacturer", "OEM: ");
      case "ASK_ANOTHER":
        return focus("Ask anything — who makes it, availability, alternatives…");
      case "UPLOAD":
        return p.upload();
      case "NEW_SEARCH":
        return p.reset();
      case "VIEW_RFQ":
        return p.openRfq(a.value!);
      case "EDIT":
        document.querySelector<HTMLButtonElement>('[data-testid="edit-requirement"], [data-testid="edit-lines"]')?.click();
        return;
      default:
        return p.act(a.type, a.value, labelled);
    }
  };

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className="flex items-end gap-2 rounded-2xl border border-graphite-200 bg-white p-2 shadow-sm focus-within:border-accent-500 focus-within:ring-4 focus-within:ring-accent-100"
    >
      <button type="button" onClick={p.upload} className="btn-ghost !min-h-11 !px-2.5" aria-label="Upload a requirement file" title="Upload the sample Excel list">
        <Icon name="upload" />
      </button>
      <textarea
        id="chat-input"
        ref={ref}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send(input);
          }
        }}
        placeholder={hint ?? (started ? "Reply, or ask anything…" : "Part number, OEM or item…")}
        aria-label="What do you need?"
        className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-base text-graphite-900 placeholder:text-graphite-400 focus:outline-none"
      />
      <button type="submit" className="btn-primary !min-h-11 !px-4" disabled={!input.trim()} aria-label="Send">
        <span className="hidden sm:inline">Send</span>
        <Icon name="send" className="h-4 w-4" />
      </button>
    </form>
  );

  if (!started) {
    return (
      <div>
        <section className="relative overflow-hidden bg-navy-900 text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative mx-auto max-w-3xl px-4 pb-24 pt-12 text-center sm:pb-28 sm:pt-20">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Global procurement &amp; sourcing</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">What do you need?</h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/75 sm:text-lg">Tell us what you&apos;re looking for. We&apos;ll help you find it.</p>
          </div>
        </section>
        <div className="relative mx-auto -mt-16 max-w-3xl px-4">
          {composer}
          <p className="mt-3 text-center text-sm text-graphite-500">
            Try:{" "}
            <button className="font-medium text-navy-700 hover:underline" onClick={() => send(EXAMPLES[ex])}>
              &ldquo;{EXAMPLES[ex]}&rdquo;
            </button>
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Quick icon="search" label="Find something" onClick={() => focus("Part number, OEM or description", "Find ")} />
            <Quick icon="quotes" label="Get a quote" onClick={() => focus("What and how many? e.g. I need 25 units of ABC123", "I need ")} />
            <Quick icon="upload" label="Upload requirement" onClick={p.upload} />
            <Quick icon="requests" label="Try a sample" onClick={() => send("I need 25 units of Part ABC123")} />
          </div>
          <div className="mt-12 grid gap-6 pb-6 text-sm text-graphite-700 sm:grid-cols-3">
            <Pillar icon="globe" title="Global sourcing" text="OEMs, authorized distributors and stockists — matched to your exact part and destination." />
            <Pillar icon="shield" title="Verified, not guessed" text="Every price, stock level and badge shows where it came from. Nothing is invented." />
            <Pillar icon="check" title="Compliance built in" text="Controlled items go to human compliance review before any supplier sees them." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-3xl flex-col px-4">
      <div className="flex items-center justify-between py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-graphite-500">Procurement assistant</span>
        <button onClick={p.reset} className="text-sm font-semibold text-accent-600">
          New request
        </button>
      </div>
      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {p.entries.map((e) =>
          e.role === "user" ? (
            <div key={e.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-navy-800 px-4 py-2.5 text-[15px] text-white">{e.text}</div>
            </div>
          ) : (
            <Assistant key={e.id} entry={e} latest={e === last} onAction={onAction} h={{ act: (t, v) => p.act(t, v), patch: async (b) => p.patch(b as Record<string, unknown>), interactive: e === last, busy: false }} />
          ),
        )}
        <div ref={end} />
      </div>
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-graphite-50 via-graphite-50 to-graphite-50/0 pb-3 pt-4 md:bottom-0 md:pb-6">{composer}</div>
    </div>
  );
}

function Assistant({ entry, latest, onAction, h }: { entry: Extract<Entry, { role: "assistant" }>; latest: boolean; onAction: (a: Action) => void; h: BlockHandlers }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">DL</div>
      <div className="min-w-0 flex-1 space-y-3">
        {entry.reply.blocks.map((b, i) => (
          <Block key={i} block={b} h={h} />
        ))}
        {latest && entry.reply.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {entry.reply.actions.map((a, i) => (
              <button key={`${a.type}-${a.value ?? i}`} className={a.primary ? "btn-primary" : "btn-secondary"} onClick={() => onAction(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Quick({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card flex min-h-20 flex-col items-start justify-between gap-2 p-3 text-left text-sm font-semibold text-graphite-900 hover:border-navy-700/40 sm:p-4">
      <Icon name={icon} className="h-5 w-5 text-accent-600" />
      {label}
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

function SignInSheet({ close, done }: { close: () => void; done: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="signin-title">
      <div className="card w-full max-w-md p-5 shadow-2xl">
        <h2 id="signin-title" className="text-lg font-semibold text-navy-900">
          Sign in to request quotations
        </h2>
        <p className="mt-1 text-sm text-graphite-500">Searching is open to everyone. Your requirement is saved and will be sent right after you sign in.</p>
        <div className="mt-4 grid gap-3">
          <div>
            <label className="label" htmlFor="si-email">
              Business e-mail
            </label>
            <input id="si-email" className="input" defaultValue="buyer@demo.test" readOnly />
          </div>
          <div>
            <label className="label" htmlFor="si-pass">
              Password
            </label>
            <input id="si-pass" className="input" type="password" defaultValue="demo-password" readOnly />
          </div>
          <button className="btn-primary w-full" onClick={done}>
            Sign in &amp; send RFQ
          </button>
          <button className="btn-ghost w-full" onClick={close}>
            Not now
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-graphite-400">Preview only — no account is created.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ buyer */

function Page({ title, sub, back, children }: { title: string; sub?: React.ReactNode; back?: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {back && (
        <button onClick={back} className="text-sm font-semibold text-accent-600">
          ← Back
        </button>
      )}
      <h1 className={`text-2xl font-semibold tracking-tight text-navy-900 ${back ? "mt-3" : ""}`}>{title}</h1>
      {sub && <div className="mt-1 text-sm text-graphite-500">{sub}</div>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <div className="font-semibold text-graphite-900">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-graphite-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const lineName = (l: RequirementLine) => l.partNumber ?? l.description ?? l.category ?? l.query;

function Requests({ rfqs, open, newRequest }: { rfqs: Rfq[]; open: (id: string) => void; newRequest: () => void }) {
  if (!rfqs.length)
    return (
      <Page title="My requests" sub="Demo Buyer Organization">
        <Empty
          title="No requests yet"
          text="Tell us what you need on Home, then press Get quotes. Your RFQ appears here with every quotation it receives."
          action={
            <button className="btn-primary" onClick={newRequest}>
              What do you need?
            </button>
          }
        />
      </Page>
    );
  return (
    <Page title="My requests" sub="Demo Buyer Organization">
      <div className="grid gap-2">
        {rfqs.map((r) => (
          <button key={r.id} onClick={() => open(r.id)} className={`card flex flex-wrap items-center justify-between gap-3 p-4 text-left hover:border-navy-700/40 ${r.quotes.length ? "border-l-4 border-l-accent-500" : ""}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-navy-900">{r.ref}</span>
                <RfqStatus status={r.status} />
              </div>
              <div className="mt-1 truncate text-sm">
                {formatQuantity(r.lines[0].quantity, r.lines[0].unit)} × {lineName(r.lines[0])}
                {r.lines.length > 1 && <span className="text-graphite-500"> + {r.lines.length - 1} more</span>}
              </div>
              <div className="text-xs text-graphite-500">
                {r.createdAt} · {r.destination} · sent to {r.recipients.length} supplier{r.recipients.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">
                {r.quotes.length} quotation{r.quotes.length === 1 ? "" : "s"} received
              </div>
              <span className="text-sm font-semibold text-accent-600">{r.quotes.length ? "View quotes" : "View"} →</span>
            </div>
          </button>
        ))}
      </div>
    </Page>
  );
}

function BuyerRfq({ rfq, back, send, shortlist }: { rfq: Rfq; back: () => void; send: (supplier: string, body: string) => void; shortlist: (s: string) => void }) {
  const [view, setView] = useState<"cards" | "compare">("cards");
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [lineKey, setLineKey] = useState(rfq.lines[0].key);
  const rows = useMemo(
    () =>
      rfq.quotes
        .map((q) => ({ q, l: q.lines.find((x) => x.key === lineKey) }))
        .filter((x): x is { q: Quote; l: QuoteLine } => Boolean(x.l))
        .sort((a, b) => a.l.unitPrice - b.l.unitPrice),
    [rfq.quotes, lineKey],
  );
  return (
    <Page title={rfq.ref} sub={`Created ${rfq.createdAt} · Deliver to ${rfq.destination} · Required by not specified`} back={back}>
      <div className="mb-6">
        <RfqStatus status={rfq.status} />
      </div>
      {rfq.status === "COMPLIANCE_REVIEW" && (
        <div className="mb-6 rounded-lg bg-warn-50 px-4 py-3 text-sm text-warn-600">
          <strong>Compliance review required.</strong> One or more items are recorded as export-controlled. Suppliers receive this request only after a compliance officer approves it.
        </div>
      )}
      <h2 className="label">Items</h2>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Quantity</th>
              <th>Condition</th>
              <th>Identification</th>
            </tr>
          </thead>
          <tbody>
            {rfq.lines.map((l, i) => (
              <tr key={l.key}>
                <td className="text-graphite-400">{i + 1}</td>
                <td>
                  {l.partNumber && <div className="font-mono font-semibold">{l.partNumber}</div>}
                  <div>{l.description ?? l.category}</div>
                  {l.manufacturer && <div className="text-xs text-graphite-500">{l.manufacturer}</div>}
                </td>
                <td>{formatQuantity(l.quantity, l.unit)}</td>
                <td>{CONDITION_LABEL[rfq.condition]}</td>
                <td>
                  <IdentificationBadge status={l.identification} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="label mt-8">Quotations received</h2>
      {!rfq.quotes.length ? (
        <div className="card p-6 text-center text-sm text-graphite-500">
          No quotations yet. Switch to <strong>Supplier</strong> at the top to answer this RFQ as Alpha Demo Industrial Supply.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-graphite-100 p-1" role="tablist">
              {(["cards", "compare"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-white text-navy-900 shadow-sm" : "text-graphite-500"}`}>
                  {v === "cards" ? "Quotations" : "Compare"}
                </button>
              ))}
            </div>
            {view === "compare" && rfq.lines.length > 1 && (
              <select id="cmp-line" className="input !min-h-9 !w-auto !py-1.5" value={lineKey} onChange={(e) => setLineKey(e.target.value)} aria-label="Line">
                {rfq.lines.map((l, i) => (
                  <option key={l.key} value={l.key}>
                    Line {i + 1}: {lineName(l)}
                  </option>
                ))}
              </select>
            )}
          </div>
          {view === "compare" ? (
            <div className="card overflow-x-auto">
              <table className="table-base min-w-[720px]">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Unit price</th>
                    <th>Qty</th>
                    <th>Line total</th>
                    <th>Lead time</th>
                    <th>Availability</th>
                    <th>Condition</th>
                    <th>Certification</th>
                    <th>Valid until</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ q, l }) => {
                    const s = supplierByKey(q.supplier);
                    return (
                      <tr key={q.supplier}>
                        <td>
                          <div className="font-semibold">{s.name}</div>
                          <div className="text-xs text-graphite-500">
                            {s.city}, {countryName(s.country)}
                          </div>
                        </td>
                        <td className="font-semibold tabular-nums">{money(l.unitPrice)}</td>
                        <td className="tabular-nums">{num(l.quantity)}</td>
                        <td className="tabular-nums">{money(l.unitPrice * l.quantity)}</td>
                        <td>{l.leadTimeDays} days</td>
                        <td>{AVAILABILITY_LABEL[l.availability]}</td>
                        <td>{CONDITION_LABEL[l.condition]}</td>
                        <td>{l.certification || "—"}</td>
                        <td>02 Nov 2026</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t border-graphite-100 px-3 py-2 text-xs text-graphite-500">Objective comparison of supplier-provided figures. DefLink does not recommend a supplier — the decision is yours.</p>
            </div>
          ) : (
            rfq.quotes.map((q) => {
              const s = supplierByKey(q.supplier);
              const l = q.lines[0];
              return (
                <div key={q.supplier} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{s.name}</span>
                        {q.revision > 1 && <span className="chip bg-accent-50 text-accent-600">Updated · rev {q.revision}</span>}
                        {q.shortlisted && <span className="chip bg-ok-50 text-ok-600">Shortlisted</span>}
                        {q.simulated && <span className="chip bg-graphite-100 text-graphite-500">Simulated response</span>}
                        <DemoBadge />
                      </div>
                      <div className="text-sm text-graphite-500">
                        {s.city}, {countryName(s.country)}
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <div className="text-lg font-semibold text-navy-900">{money(l.unitPrice)}</div>
                      <div className="text-xs text-graphite-500">per unit · supplier quotation</div>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                    <Fact k="Quantity" v={num(l.quantity)} />
                    <Fact k="Availability" v={AVAILABILITY_LABEL[l.availability]} />
                    <Fact k="Lead time" v={`${l.leadTimeDays} days`} />
                    <Fact k="Condition" v={CONDITION_LABEL[l.condition]} />
                    <Fact k="Certification" v={l.certification || "Not stated"} />
                    <Fact k="Incoterm" v={q.incoterm || "—"} />
                    <Fact k="Valid until" v="02 Nov 2026" />
                    <Fact k="Lines quoted" v={`${q.lines.length} of ${rfq.lines.length}`} />
                  </dl>
                  {open === q.supplier && (
                    <div className="mt-3 space-y-2 rounded-lg bg-graphite-50 p-3 text-sm">
                      <div>Payment terms: {q.paymentTerms || "Not stated"}</div>
                      {q.note && <div>Revision note: {q.note}</div>}
                      {q.history.length > 0 && (
                        <ul className="text-xs text-graphite-700">
                          {q.history.map((h) => (
                            <li key={h.revision}>
                              Rev {h.revision} · {money(h.unitPrice)}/unit · {h.leadTimeDays} days · superseded
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => setOpen(open === q.supplier ? null : q.supplier)}>
                      {open === q.supplier ? "Hide quote" : "View quote"}
                    </button>
                    <button className="btn-secondary !min-h-9 !py-1.5" onClick={() => setThread(q.supplier)}>
                      Ask supplier
                    </button>
                    <button className="btn-ghost !min-h-9 !py-1.5" onClick={() => shortlist(q.supplier)}>
                      {q.shortlisted ? "Remove from shortlist" : "Shortlist"}
                    </button>
                  </div>
                  {thread === q.supplier && <Thread msgs={rfq.threads[q.supplier] ?? []} me="buyer" title={`Conversation with ${s.name}`} send={(b) => send(q.supplier, b)} />}
                </div>
              );
            })
          )}
        </div>
      )}

      <h2 className="label mt-8">Suppliers contacted</h2>
      {rfq.recipients.length === 0 ? (
        <p className="text-sm text-graphite-500">Not sent yet — awaiting compliance review.</p>
      ) : (
        <div className="card divide-y divide-graphite-100">
          {rfq.recipients.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-graphite-500">
                  {countryName(r.country)} · matched because: {r.reasons.join("; ")}
                </div>
              </div>
              <span className="chip bg-graphite-100 text-graphite-700">{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-graphite-500">Your organization&apos;s name is not shown to suppliers. Unverified suppliers never receive RFQs.</p>
    </Page>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-graphite-400">{k}</dt>
      <dd className="text-graphite-900">{v}</dd>
    </div>
  );
}

function Thread({ msgs, me, title, send }: { msgs: Msg[]; me: "buyer" | "supplier"; title: string; send: (b: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="card mt-3 overflow-hidden">
      <div className="border-b border-graphite-100 px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="max-h-80 min-h-24 space-y-3 overflow-y-auto px-4 py-3">
        {!msgs.length && <p className="text-sm text-graphite-500">No messages yet. Questions and answers stay attached to this request.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === me ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === me ? "bg-navy-800 text-white" : m.body.startsWith("Updated quotation") ? "bg-accent-50 text-navy-900" : "bg-graphite-100"}`}>
              <div className={`mb-0.5 text-[11px] font-semibold ${m.from === me ? "text-white/70" : "text-graphite-500"}`}>{m.from === me ? "You" : m.from === "buyer" ? "Buyer" : "Supplier"}</div>
              {m.body}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-graphite-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text.trim());
          setText("");
        }}
      >
        <input id={`thread-${title}`} className="input" placeholder={me === "buyer" ? "e.g. Can you supply 100 instead of 25?" : "Reply to the buyer"} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="btn-primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function QuotesList({ rfqs, open }: { rfqs: Rfq[]; open: (id: string) => void }) {
  const all = rfqs.flatMap((r) => r.quotes.map((q) => ({ r, q })));
  return (
    <Page title="Quotations" sub="Current quotations across your requests">
      {!all.length ? (
        <Empty title="No quotations yet" text="When suppliers respond to your requests, their quotations appear here." />
      ) : (
        <div className="grid gap-2">
          {all.map(({ r, q }) => (
            <button key={r.id + q.supplier} onClick={() => open(r.id)} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-left hover:border-navy-700/40">
              <div>
                <div className="font-semibold">{supplierByKey(q.supplier).name}</div>
                <div className="text-xs text-graphite-500">
                  {r.ref} · revision {q.revision}
                </div>
              </div>
              <div className="text-right font-semibold text-navy-900">{money(q.lines[0].unitPrice)}/unit</div>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}

function Messages({ rfqs, role, open }: { rfqs: Rfq[]; role: Role; open: (id: string) => void }) {
  const threads = rfqs.flatMap((r) => Object.entries(r.threads).filter(([s]) => role === "buyer" || s === SUPPLIER_ME).map(([s, m]) => ({ r, s, last: m[m.length - 1] })));
  return (
    <Page title="Messages" sub="Every conversation is attached to its request">
      {!threads.length ? (
        <Empty title="No messages yet" text={role === "buyer" ? "Ask a supplier a question from any quotation." : "Questions from buyers about your RFQs appear here."} />
      ) : (
        <div className="card divide-y divide-graphite-100">
          {threads.map((t) => (
            <button key={t.r.id + t.s} onClick={() => open(t.r.id)} className="block w-full px-4 py-3 text-left hover:bg-graphite-50">
              <div className="font-semibold">{role === "buyer" ? supplierByKey(t.s).name : "Buyer"}</div>
              <div className="font-mono text-xs text-graphite-500">{t.r.ref}</div>
              <div className="truncate text-sm text-graphite-700">{t.last.body}</div>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}

function Account({ role, signedIn }: { role: Role; signedIn: boolean }) {
  const s = supplierByKey(SUPPLIER_ME);
  const rows: [string, string][] =
    role === "buyer"
      ? [
          ["Name", "Ayesha Demo"],
          ["Organization", "Demo Buyer Organization (DEMO)"],
          ["Role", "Procurement Officer"],
          ["Country", "Pakistan"],
          ["Signed in", signedIn ? "Yes (preview)" : "Not yet — sign-in is asked only when you request quotes"],
        ]
      : [
          ["Organization", `${s.name} (DEMO)`],
          ["Supplier type", "Stockist"],
          ["Location", `${s.city}, ${countryName(s.country)}`],
          ["Categories", s.categories.join(", ")],
        ];
  return (
    <Page title="Account">
      <div className="card divide-y divide-graphite-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3 text-sm">
            <span className="text-graphite-500">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      {role === "supplier" && (
        <div className="card mt-4 p-4">
          <div className="label">Verification</div>
          <VerificationBadges levels={s.levels} />
        </div>
      )}
      <div className="card mt-4 p-4 text-sm text-graphite-700">
        <div className="label">Security in the full app</div>
        Two-factor authentication (authenticator app), role-based access for 8 organization roles, organization data isolation, and a tamper-evident audit log.
      </div>
    </Page>
  );
}

/* --------------------------------------------------------------- supplier */

function Inbox({ rfqs, open }: { rfqs: Rfq[]; open: (id: string) => void }) {
  const me = supplierByKey(SUPPLIER_ME);
  return (
    <Page title="Incoming RFQs" sub={<span className="flex flex-wrap items-center gap-2">{me.name} <VerificationBadges levels={me.levels} /></span>}>
      {!rfqs.length ? (
        <Empty title="Nothing here yet" text="Switch to Buyer, ask for a part (try “I need 25 units of Part ABC123”) and press Get quotes. Matching RFQs arrive here." />
      ) : (
        <div className="grid gap-2">
          {rfqs.map((r) => {
            const rec = r.recipients.find((x) => x.key === SUPPLIER_ME)!;
            return (
              <button key={r.id} onClick={() => open(r.id)} className={`card flex flex-wrap items-center justify-between gap-3 p-4 text-left hover:border-navy-700/40 ${rec.status === "SENT" ? "border-l-4 border-l-accent-500" : ""}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-navy-900">{r.ref}</span>
                    {rec.status === "SENT" && <span className="chip bg-accent-500 text-white">New</span>}
                  </div>
                  <div className="mt-1 text-sm">
                    {lineName(r.lines[0])} · {formatQuantity(r.lines[0].quantity, r.lines[0].unit)}
                    {r.lines.length > 1 && <span className="text-graphite-500"> + {r.lines.length - 1} more</span>}
                  </div>
                  <div className="text-xs text-graphite-500">Destination {r.destination}</div>
                </div>
                <span className="chip bg-graphite-100 text-graphite-700">{rec.status.charAt(0) + rec.status.slice(1).toLowerCase()}</span>
              </button>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function SupplierRfq({ rfq, back, submit, send }: { rfq: Rfq; back: () => void; submit: (q: Omit<Quote, "supplier" | "revision" | "history">) => void; send: (b: string) => void }) {
  const mine = rfq.quotes.find((q) => q.supplier === SUPPLIER_ME);
  const rec = rfq.recipients.find((x) => x.key === SUPPLIER_ME)!;
  const [rows, setRows] = useState(() =>
    rfq.lines.map((l) => {
      const prev = mine?.lines.find((x) => x.key === l.key);
      const listed = listingFor(SUPPLIER_ME, l.productId);
      return { key: l.key, unitPrice: prev ? String(prev.unitPrice) : "", quantity: String(prev?.quantity ?? l.quantity ?? 1), lead: prev ? String(prev.leadTimeDays) : listed?.lead ? String(listed.lead) : "", availability: prev?.availability ?? ((listed?.qty ?? 0) > 0 ? "IN_STOCK" : "FACTORY_ORDER"), cert: prev?.certification ?? listed?.cert ?? "", include: true };
    }),
  );
  const [incoterm, setIncoterm] = useState(mine?.incoterm ?? "DAP");
  const [terms, setTerms] = useState(mine?.paymentTerms ?? "");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = (i: number, k: string, v: string | boolean) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <Page title={rfq.ref} sub={`Buyer organization · ${countryName(rfq.destinationCountry) || "—"} · Deliver to ${rfq.destination}`} back={back}>
      <p className="-mt-4 mb-6 text-xs text-graphite-400">You received this RFQ because: {rec.reasons.join("; ")}. The buyer&apos;s name is withheld.</p>
      <h2 className="label">Requested items</h2>
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Part number</th>
              <th>Description</th>
              <th>Quantity</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody>
            {rfq.lines.map((l, i) => (
              <tr key={l.key}>
                <td className="text-graphite-400">{i + 1}</td>
                <td className="font-mono font-semibold">{l.partNumber ?? "—"}</td>
                <td>{l.description ?? l.category}</td>
                <td>{formatQuantity(l.quantity, l.unit)}</td>
                <td>{CONDITION_LABEL[rfq.condition]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="label mt-8">{mine ? `Your quotation · revision ${mine.revision}` : "Submit quotation"}</h2>
      {mine && (
        <div className="card mb-4 p-4 text-sm font-semibold">
          {money(mine.lines[0].unitPrice)}/unit · {mine.lines[0].leadTimeDays} days · valid until 02 Nov 2026
        </div>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const chosen = rows.filter((r) => r.include);
          if (chosen.some((r) => !(Number(r.unitPrice) > 0) || r.lead === "")) return setErr("Enter a unit price and lead time for every quoted line.");
          if (mine && !note.trim()) return setErr("Add a short note explaining what changed in this revision.");
          setErr(null);
          submit({
            lines: chosen.map((r) => ({ key: r.key, unitPrice: Number(r.unitPrice), quantity: Number(r.quantity), availability: r.availability, leadTimeDays: Number(r.lead), condition: "NEW", certification: r.cert })),
            incoterm,
            paymentTerms: terms,
            validUntil: validDate,
            note: mine ? note : undefined,
          });
          setNote("");
        }}
      >
        {rfq.lines.map((l, i) => (
          <fieldset key={l.key} className="card p-4">
            <legend className="sr-only">Line {i + 1}</legend>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono font-semibold">{l.partNumber ?? `Line ${i + 1}`}</div>
                <div className="text-sm text-graphite-500">
                  {l.description ?? l.category} · requested {formatQuantity(l.quantity, l.unit)}
                </div>
              </div>
              {rfq.lines.length > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  <input id={`inc-${i}`} type="checkbox" checked={rows[i].include} onChange={(e) => set(i, "include", e.target.checked)} /> Quote this line
                </label>
              )}
            </div>
            {rows[i].include && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field id={`up-${i}`} label="Unit price (USD)">
                  <input id={`up-${i}`} className="input" inputMode="decimal" placeholder="e.g. 4700" value={rows[i].unitPrice} onChange={(e) => set(i, "unitPrice", e.target.value.replace(/[^\d.]/g, ""))} />
                </Field>
                <Field id={`q-${i}`} label="Quantity">
                  <input id={`q-${i}`} className="input" inputMode="decimal" value={rows[i].quantity} onChange={(e) => set(i, "quantity", e.target.value.replace(/[^\d.]/g, ""))} />
                </Field>
                <Field id={`av-${i}`} label="Availability">
                  <select id={`av-${i}`} className="input" value={rows[i].availability} onChange={(e) => set(i, "availability", e.target.value)}>
                    <option value="IN_STOCK">In stock</option>
                    <option value="PARTIAL">Partial stock</option>
                    <option value="FACTORY_ORDER">Factory order</option>
                  </select>
                </Field>
                <Field id={`lt-${i}`} label="Lead time (days)">
                  <input id={`lt-${i}`} className="input" inputMode="numeric" value={rows[i].lead} onChange={(e) => set(i, "lead", e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Field id={`ce-${i}`} label="Certification">
                  <input id={`ce-${i}`} className="input" placeholder="e.g. CoC" value={rows[i].cert} onChange={(e) => set(i, "cert", e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
        ))}
        <div className="card grid grid-cols-2 gap-3 p-4">
          <Field id="incoterm" label="Incoterm">
            <select id="incoterm" className="input" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
              {["EXW", "FCA", "CPT", "CIP", "DAP", "DDP", "FOB", "CFR", "CIF"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field id="terms" label="Payment terms">
            <input id="terms" className="input" placeholder="e.g. 30% advance" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          {mine && (
            <div className="col-span-2">
              <Field id="rev-note" label="What changed in this revision? (required)">
                <input id="rev-note" className="input" placeholder="e.g. Volume price for 100 units" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
        {err && <p className="text-sm text-danger-600">{err}</p>}
        <button className="btn-primary w-full sm:w-auto">{mine ? `Submit revision ${mine.revision + 1}` : "Submit quotation"}</button>
      </form>

      <h2 className="label mt-8">Messages with the buyer</h2>
      <Thread msgs={rfq.threads[SUPPLIER_ME] ?? []} me="supplier" title="Buyer conversation" send={send} />
    </Page>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
