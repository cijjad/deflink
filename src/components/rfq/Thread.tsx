"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dateTime } from "@/lib/format";

interface Msg {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  sender: string;
  quotationId: string | null;
}

export function Thread({ rfqId, supplierOrgId, title, canSend = true }: { rfqId: string; supplierOrgId: string; title: string; canSend?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rfqs/${rfqId}/threads/${supplierOrgId}`, { cache: "no-store" });
    if (res.ok) setMessages((await res.json()).messages);
  }, [rfqId, supplierOrgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch then poll
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/rfqs/${rfqId}/threads/${supplierOrgId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
    setSending(false);
    if (!res.ok) return setError((await res.json())?.error?.message ?? "Could not send.");
    setText("");
    load();
  }

  return (
    <div className="card flex flex-col overflow-hidden" data-testid="thread">
      <div className="border-b border-graphite-100 px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="max-h-96 min-h-32 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-sm text-graphite-500">No messages yet. Questions and answers stay attached to this request.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.mine ? "bg-navy-800 text-white" : m.quotationId ? "bg-accent-50 text-navy-900" : "bg-graphite-100 text-graphite-900"}`} data-testid="thread-message">
              <div className={`mb-0.5 text-[11px] font-semibold ${m.mine ? "text-white/70" : "text-graphite-500"}`}>
                {m.sender} · {dateTime(m.createdAt)}
              </div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {canSend && (
        <form onSubmit={send} className="flex gap-2 border-t border-graphite-100 p-3">
          <input className="input" placeholder="Ask a question — e.g. Can you supply 100 instead of 50?" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" data-testid="thread-input" />
          <button className="btn-primary" disabled={sending || !text.trim()}>
            Send
          </button>
        </form>
      )}
      {error && <p className="px-4 pb-3 text-sm text-danger-600">{error}</p>}
    </div>
  );
}
