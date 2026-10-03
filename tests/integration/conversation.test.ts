import { describe, expect, it } from "vitest";
import { chatTurn, addExtractedLines, patchRequirement } from "@/server/services/conversation";

const owner = { anonToken: "test-anon-" + Math.random() };
const texts = (r: Awaited<ReturnType<typeof chatTurn>>) =>
  r.reply.blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" | ");
const actions = (r: Awaited<ReturnType<typeof chatTurn>>) => r.reply.actions.map((a) => a.type);

describe("success test 1 — single part", () => {
  it("identifies, asks only what is missing, and becomes ready", async () => {
    let r = await chatTurn({ text: "I need 25 units of Part ABC123." }, owner);
    expect(r.state.lines).toHaveLength(1);
    expect(r.state.lines[0]).toMatchObject({ partNumber: "ABC123", quantity: 25, identification: "EXACT", manufacturer: "XYZ Demo Industries" });
    expect(texts(r)).toMatch(/I found .*ABC123/);
    expect(texts(r)).toMatch(/New only\?/);
    expect(r.state.awaiting).toBe("CONDITION");
    const results = r.reply.blocks.find((b) => b.type === "results");
    expect(results).toBeTruthy();

    r = await chatTurn({ conversationId: r.conversationId, text: "New." }, owner);
    expect(r.state.condition).toBe("NEW");
    expect(texts(r)).toMatch(/Where should it be delivered\?/);

    r = await chatTurn({ conversationId: r.conversationId, text: "Islamabad, Pakistan." }, owner);
    expect(r.state.destination).toMatchObject({ city: "Islamabad", country: "PK" });
    expect(r.ready).toBe(true);
    expect(texts(r)).toMatch(/Everything required is ready/);
    expect(actions(r)).toContain("GET_QUOTES");
  });

  it("search first, then quantity in natural language", async () => {
    let r = await chatTurn({ text: "Find ABC123" }, owner);
    expect(actions(r)).toEqual(["GET_QUOTE", "VIEW_SOURCES", "ASK_ANOTHER"]);
    r = await chatTurn({ conversationId: r.conversationId, text: "I need 50." }, owner);
    expect(r.state.lines[0].quantity).toBe(50);
    expect(texts(r)).toMatch(/50 units of ABC123/);
    r = await chatTurn({ conversationId: r.conversationId, text: "Who makes this?" }, owner);
    expect(JSON.stringify(r.reply.blocks)).toContain("XYZ Demo Industries");
    r = await chatTurn({ conversationId: r.conversationId, text: "Find this item in Europe" }, owner);
    const sources = r.reply.blocks.find((b) => b.type === "sources") as { sources: { country: string }[] } | undefined;
    expect(sources?.sources.every((s) => ["GB", "DE", "TR"].includes(s.country))).toBe(true);
  });

  it("unknown part number is not fabricated", async () => {
    const r = await chatTurn({ text: "Find ZZQ-998877" }, owner);
    expect(r.state.lines[0].identification).toBe("NOT_IDENTIFIED");
    expect(texts(r)).toMatch(/I don't have verified information for ZZQ-998877/);
  });

  it("near-miss part number asks for confirmation", async () => {
    const r = await chatTurn({ text: "I need 5 of ABC124" }, owner);
    expect(r.state.lines[0].identification).toBe("NEEDS_CONFIRMATION");
    expect(actions(r)).toContain("CHOOSE_CANDIDATE");
    const choose = r.reply.actions.find((a) => a.type === "CHOOSE_CANDIDATE" && a.label.includes("ABC123"))!;
    const r2 = await chatTurn({ conversationId: r.conversationId, action: { type: "CHOOSE_CANDIDATE", value: choose.value } }, owner);
    expect(r2.state.lines[0]).toMatchObject({ partNumber: "ABC123", identification: "EXACT" });
    expect(r2.state.awaiting).toBe("CONDITION");
  });

  it("generic item asks for part number / OEM once, accepts I don't know", async () => {
    let r = await chatTurn({ text: "I need 50 filters" }, owner);
    expect(actions(r)).toEqual(["PART_NUMBER", "OEM", "DONT_KNOW"]);
    r = await chatTurn({ conversationId: r.conversationId, text: "I don't know" }, owner);
    expect(texts(r)).toMatch(/Describe what the filter is used for/);
    r = await chatTurn({ conversationId: r.conversationId, text: "for the hydraulic system of a forklift" }, owner);
    expect(r.state.lines[0].description).toMatch(/forklift/);
    expect(r.state.awaiting).toBe("CONDITION");
  });

  it("other owners cannot continue someone else's conversation", async () => {
    const r = await chatTurn({ text: "Find ABC123" }, owner);
    const other = await chatTurn({ conversationId: r.conversationId, text: "I need 5" }, { anonToken: "someone-else" });
    expect(other.conversationId).not.toBe(r.conversationId);
  });
});

describe("success test 2 — multi-item", () => {
  it("creates three identified lines", async () => {
    const r = await chatTurn({ text: "I need 50 bearings, 20 filters and 10 pumps." }, owner);
    expect(r.state.lines.map((l) => [l.category, l.quantity, l.identification])).toEqual([
      ["Bearing", 50, "ITEM_TYPE"],
      ["Filter", 20, "ITEM_TYPE"],
      ["Pump", 10, "ITEM_TYPE"],
    ]);
    expect(r.reply.blocks.some((b) => b.type === "lines")).toBe(true);
    expect(r.reply.actions[0]).toMatchObject({ type: "GET_QUOTES", label: "Create RFQ" });
    const r2 = await chatTurn({ conversationId: r.conversationId, action: { type: "GET_QUOTES" } }, owner);
    expect(r2.state.awaiting).toBe("CONDITION");
  });
});

describe("success test 3 — file lines", () => {
  it("classifies and allows correction without restarting", async () => {
    const rows = [
      ...["ABC123", "HP-4521", "FLT-200-10", "FLT-300-25", "LF-AIR-900", "LF-FUEL-45", "BRG-6205-DMO", "BRG-6308-DMO", "BRG-22210-DMO", "KM-GBX-40", "KM-BLT-1200", "MFP-CYL-63", "MFP-HOSE-12", "MFP-SV-24", "NS-ORK-112", "NS-SEAL-75", "OA-SNS-310"].map((pn, i) => ({ partNumber: pn, quantity: i + 1 })),
      { partNumber: "OA-CON-29", quantity: 4 },
      { partNumber: "NS-GSK-405", quantity: 2 },
      { partNumber: "QQQ-0000-ZZ", description: "Widget", quantity: 1 },
    ];
    const r = await addExtractedLines(undefined, owner, "req.xlsx", rows);
    expect(r.state.lines).toHaveLength(20);
    const text = texts(r);
    expect(text).toContain("I found 20 items: 17 identified exactly, 2 need confirmation and 1 could not be identified.");
    const bad = r.state.lines.find((l) => l.partNumber === "OA-CON-29")!;
    const fixed = await patchRequirement(r.conversationId, owner, { lines: [{ key: bad.key, partNumber: "OA-CON-28" }] });
    expect(fixed.state.lines.find((l) => l.key === bad.key)).toMatchObject({ identification: "EXACT", partNumber: "OA-CON-28" });
    expect(fixed.state.lines).toHaveLength(20);
  });
});
