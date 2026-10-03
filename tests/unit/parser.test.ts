import { describe, expect, it } from "vitest";
import { parseMessage, parseWordNumber, normalizePartNumber } from "@/core/conversation/parser";

const NOW = new Date("2026-10-03T00:00:00Z");
const p = (s: string, awaiting?: NonNullable<Parameters<typeof parseMessage>[1]>["awaiting"]) => parseMessage(s, { now: NOW, awaiting });

describe("quantities", () => {
  it.each([
    ["I need 50.", 50, "EA", false],
    ["around 50", 50, "EA", true],
    ["25 units", 25, "EA", false],
    ["I need 3 sets", 3, "SET", false],
    ["100 pieces", 100, "PR".replace("PR", "EA"), false],
    ["two dozen", 24, "EA", false],
    ["2 dozen", 24, "EA", false],
    ["twenty five", 25, "EA", false],
    ["1,200 pcs", 1200, "EA", false],
    ["a hundred", 100, "EA", false],
  ])("%s", (text, value, unit, approx) => {
    const r = p(text, "QUANTITY");
    expect(r.items).toHaveLength(0);
    expect(r.quantity?.value).toBe(value);
    expect(r.quantity?.unit).toBe(unit);
    expect(r.quantity?.approximate).toBe(approx);
  });

  it("keeps the user's words", () => {
    expect(p("two dozen").quantity?.text).toBe("two dozen");
  });

  it("word numbers", () => {
    expect(parseWordNumber(["half", "a", "dozen"])?.value).toBe(6);
    expect(parseWordNumber(["two", "hundred", "and", "fifty"])?.value).toBe(250);
    expect(parseWordNumber(["a", "pump"])).toBeNull();
  });
});

describe("part numbers", () => {
  it("I need 25 units of Part ABC123", () => {
    const r = p("I need 25 units of Part ABC123.");
    expect(r.items).toEqual([expect.objectContaining({ partNumber: "ABC123", quantity: expect.objectContaining({ value: 25, unit: "EA" }) })]);
    expect(r.purchaseIntent).toBe(true);
  });
  it("I need hydraulic pump Part No. HP-4521.", () => {
    const r = p("I need hydraulic pump Part No. HP-4521.");
    expect(r.items[0].partNumber).toBe("HP-4521");
    expect(r.items[0].category).toBe("Hydraulic Pump");
  });
  it("Find Part No. ABC-12345", () => {
    const r = p("Find Part No. ABC-12345");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].partNumber).toBe("ABC-12345");
    expect(r.items[0].quantity).toBeUndefined();
    expect(r.purchaseIntent).toBe(false);
  });
  it("Find ABC123", () => {
    expect(p("Find ABC123").items[0].partNumber).toBe("ABC123");
  });
  it("trailing quantity", () => {
    const r = p("ABC123 x 25");
    expect(r.items[0]).toMatchObject({ partNumber: "ABC123", quantity: { value: 25 } });
    const r2 = p("HP-4521 qty: 10");
    expect(r2.items[0]).toMatchObject({ partNumber: "HP-4521", quantity: { value: 10 } });
  });
  it("NSN", () => {
    const r = p("Find NSN 2910-01-234-5678");
    expect(r.items[0].nsn).toBe("2910-01-234-5678");
  });
  it("does not treat 25pcs or RFQ refs as part numbers", () => {
    expect(p("25pcs").items).toHaveLength(0);
    expect(p("status of RFQ-10001").items.every((i) => i.partNumber !== "RFQ-10001")).toBe(true);
  });
  it("normalises", () => {
    expect(normalizePartNumber("hp-4521")).toBe("HP4521");
    expect(normalizePartNumber("HP 4521")).toBe("HP4521");
  });
});

describe("items", () => {
  it("multi-item", () => {
    const r = p("I need 50 bearings, 20 filters and 10 pumps.");
    expect(r.items.map((i) => [i.category, i.quantity?.value])).toEqual([
      ["Bearing", 50],
      ["Filter", 20],
      ["Pump", 10],
    ]);
  });
  it("I need 25 hydraulic pumps", () => {
    const r = p("I need 25 hydraulic pumps");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ category: "Hydraulic Pump", quantity: { value: 25 } });
  });
  it("I need 100 filters delivered to Islamabad", () => {
    const r = p("I need 100 filters delivered to Islamabad");
    expect(r.items[0]).toMatchObject({ category: "Filter", quantity: { value: 100 } });
    expect(r.destination).toMatchObject({ city: "Islamabad", country: "PK" });
  });
  it("I need 100 industrial filters", () => {
    expect(p("I need 100 industrial filters").items[0].text).toBe("industrial filters");
  });
});

describe("condition", () => {
  it.each([
    ["New.", "NEW"],
    ["new only", "NEW"],
    ["New or approved alternative", "NEW_OR_APPROVED_ALTERNATIVE"],
    ["Any condition", "ANY"],
    ["overhauled is fine", "OVERHAULED"],
  ])("%s", (t, c) => {
    const r = p(t, "CONDITION");
    expect(r.condition).toBe(c);
    expect(r.items).toHaveLength(0);
  });
  it("any (when asked)", () => expect(p("any", "CONDITION").condition).toBe("ANY"));
  it("New York is not a condition", () => {
    const r = p("deliver to New York");
    expect(r.condition).toBeUndefined();
    expect(r.destination).toMatchObject({ city: "New York", country: "US" });
  });
});

describe("destination", () => {
  it("Islamabad, Pakistan.", () => {
    const r = p("Islamabad, Pakistan.", "DESTINATION");
    expect(r.destination).toMatchObject({ city: "Islamabad", country: "PK" });
    expect(r.items).toHaveLength(0);
  });
  it("Pakistan.", () => {
    expect(p("Pakistan.").destination).toMatchObject({ country: "PK" });
  });
  it("I need this delivered to Pakistan", () => {
    expect(p("I need this delivered to Pakistan").destination?.country).toBe("PK");
  });
  it("unknown place when asked keeps words", () => {
    expect(p("Gwadar Port", "DESTINATION").destination).toEqual({ text: "Gwadar Port" });
  });
  it("source region is not destination", () => {
    const r = p("Find this item in Europe");
    expect(r.sourceRegion).toBe("europe");
    expect(r.destination).toBeUndefined();
    expect(r.intents).toContain("FIND_SUPPLIERS");
  });
});

describe("intents", () => {
  it.each([
    ["Who makes this?", "WHO_MAKES"],
    ["Who supplies this OEM?", "FIND_SUPPLIERS"],
    ["Is this part available?", "AVAILABILITY"],
    ["What is the estimated price?", "PRICE"],
    ["Can you find an alternative?", "ALTERNATIVE"],
    ["What information do you need from me?", "WHAT_NEEDED"],
    ["I don't know", "DONT_KNOW"],
    ["Create an RFQ", "GET_QUOTES"],
    ["get quotes", "GET_QUOTES"],
  ])("%s", (t, intent) => {
    const r = p(t);
    expect(r.intents).toContain(intent);
    expect(r.items).toHaveLength(0);
  });
});

describe("dates & certification", () => {
  it("within 30 days", () => {
    const r = p("I need 10 pumps within 30 days");
    expect(r.requiredBy).toBe("2026-11-02");
    expect(r.items[0].quantity?.value).toBe(10);
  });
  it("by 15 December", () => expect(p("needed by 15 December").requiredBy).toBe("2026-12-15"));
  it("certification", () => expect(p("I need 5 ABC123 with CoC").certification).toBe("CoC"));
});
