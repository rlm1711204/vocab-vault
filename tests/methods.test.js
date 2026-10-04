import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = [];
let reply = async () => ({ words: [], provider: "Gemini", skipped: [] });
vi.mock("../src/lib/engine.js", async (orig) => ({ ...(await orig()), aiTask: (s, task) => (calls.push(task), reply(task)) }));

const { methodsFor, Q_CARD_SCHEMA, Q_LIST_SCHEMA, qCardInstruction, quantSystem } = await import("../src/lib/quant-ai.js");
const { buildMethodsPrompt, buildQuantMaterialPrompt, readQuant } = await import("../src/lib/quant-prompt.js");
const { makeQItem, qItemsToCSV } = await import("../src/lib/quant.js");
const { maths: q } = await import("../src/lib/quant-stores.js");
const { sections, sortItems, dayLabel } = await import("../src/lib/sortlist.js");

beforeEach(() => {
  calls.length = 0;
  q.resetAll();
});

describe("two methods: standard and shortest", () => {
  it("reads M2: lines with their time, and keeps both methods", () => {
    const [it] = readQuant(`## Quant › Percentage
Q: A price rises by 25%. By what % must use fall to keep spending the same?
A: 20%
O: 25%; 15%; 30%
S: Let price = 100, new price = 125.
S: Spending same → use = 100/125 = 0.8 → fall of 20%.
Method 2: (≈5 s) r/(100 + r) × 100 = 25/125 × 100 = 20%.
Using the 1/4 → 1/5 fraction rule.`).items;
    expect(it.solution).toBe("Let price = 100, new price = 125.\nSpending same → use = 100/125 = 0.8 → fall of 20%.");
    expect(it.shortcut).toBe("r/(100 + r) × 100 = 25/125 × 100 = 20%.\nUsing the 1/4 → 1/5 fraction rule.");
    expect(it.fastSecs).toBe(5);
    const item = makeQItem(it);
    expect(item).toMatchObject({ fastSecs: 5, shortcut: expect.stringContaining("25/125") });
    expect(makeQItem({ kind: "formula", q: "F", shortcut: "x", seconds: 9 })).toMatchObject({ shortcut: "", fastSecs: 0 });
    expect(qItemsToCSV([item]).split("\n")[0]).toContain("Method 2 (shortest)");
  });

  it("asks the AI for both methods everywhere, keeping the material's own working as Method 1", () => {
    expect(Q_CARD_SCHEMA.properties.items.items.required).toEqual(expect.arrayContaining(["shortcut", "seconds"]));
    expect(Q_CARD_SCHEMA.properties.items.items.properties.similar.items.required).toEqual(expect.arrayContaining(["shortcut", "seconds"]));
    expect(Q_LIST_SCHEMA.properties.items.items.required).toContain("working");
    expect(quantSystem({ exam: "ssc" })).toMatch(/TWO methods[\s\S]*SHORTEST/);
    expect(qCardInstruction([{ kind: "question", q: "Q1", a: "5", solution: "step one\nstep two" }], false)).toMatch(/Given method: step one \/ step two/);
    expect(buildQuantMaterialPrompt({})).toMatch(/M2: lines = Method 2, the SHORTEST/);
  });

  it("adds Method 2 to saved questions (AI or the pasted prompt answer) without changing answers or Method 1", async () => {
    const [a, b] = q.addItems([
      { kind: "question", q: "A does a work in 10 days and B in 15. Together?", a: "6 days", solution: "1/10 + 1/15 = 1/6 → 6 days", subject: "Quant", topic: "Time & Work" },
      { kind: "question", q: "Find 20% of 50.", a: "10", subject: "Quant", topic: "Percentage" },
    ]).added;
    reply = async () => ({ words: [{ n: 2, solution: "50 × 20/100 = 10", shortcut: "10% of 50 = 5, so 20% = 10.", seconds: 3 }, { n: 1, solution: "IGNORED", shortcut: "Product ÷ sum = 150/25 = 6.", seconds: 8 }], provider: "Gemini", skipped: [] });
    const r = await methodsFor({}, [a, b]);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/Given method: 1\/10/);
    const byId = Object.fromEntries(r.done.map((d) => [d.id, d]));
    expect(byId[a.id]).toEqual({ id: a.id, solution: "1/10 + 1/15 = 1/6 → 6 days", shortcut: "Product ÷ sum = 150/25 = 6.", fastSecs: 8 });
    expect(byId[b.id]).toMatchObject({ solution: "50 × 20/100 = 10", fastSecs: 3 });

    // The copy-paste route: the reply repeats each question, so its methods fill the saved card.
    const prompt = buildMethodsPrompt([b]);
    expect(prompt).toMatch(/Q: Find 20% of 50\.\nA: 10\nS: …\nM2:/);
    const answer = "## Quant › Percentage\nQ: Find 20% of 50.\nA: 10\nGiven method: none\nS: 50 × 20/100 = 10\nM2: (≈3 s) 10% is 5, so 20% is 10.";
    const res = q.addItems(readQuant(answer).items);
    expect(res.added).toHaveLength(0);
    expect(q.byId(b.id)).toMatchObject({ a: "10", shortcut: "10% is 5, so 20% is 10.", fastSecs: 3, solution: "50 × 20/100 = 10" });
  });
});

describe("sorted list of saved questions", () => {
  const it3 = [
    { id: "a", q: "Bravo", addedAt: "2026-10-01T10:00:00Z", lapses: 0, box: 3, due: "2026-10-09", difficulty: 2 },
    { id: "b", q: "alpha", addedAt: "2026-10-04T08:00:00Z", lapses: 2, box: 1, due: "2026-10-05", difficulty: 4, lastReviewed: "2026-10-03" },
    { id: "c", q: "Charlie", addedAt: "2026-10-04T09:00:00Z", lapses: 0, box: 0, due: "2026-10-04", difficulty: 3 },
  ];
  it("orders by newest, oldest, weakest, due, hardest, A → Z, and groups by day", () => {
    const ids = (s) => sortItems(it3, s).map((i) => i.id);
    expect(ids("newest")).toEqual(["c", "b", "a"]);
    expect(ids("oldest")).toEqual(["a", "b", "c"]);
    expect(ids("weakest")).toEqual(["b", "c", "a"]);
    expect(ids("due")).toEqual(["c", "b", "a"]);
    expect(ids("hardest")).toEqual(["b", "c", "a"]);
    expect(ids("az")).toEqual(["b", "a", "c"]);
    expect(ids("revised")[0]).toBe("b");
    const now = new Date("2026-10-04T12:00:00");
    expect(sections(sortItems(it3, "newest"), "newest", now).map((s) => [s.label, s.items.length])).toEqual([["Today", 2], [dayLabel("2026-10-01T10:00:00Z", now), 1]]);
    expect(dayLabel(new Date("2026-10-03T12:00:00").toISOString(), now)).toBe("Yesterday");
    expect(sections(it3, "az")).toEqual([{ label: "", items: it3 }]);
    expect(sections([{ id: "f", book: true, addedAt: "2026-01-01T00:00:00Z" }], "newest", now)[0].label).toBe("Built in");
  });
});

describe("solutions from your notes, your own solution, and the built-in solver", () => {
  it("keeps the PDF's own working as Method 1, word for word, and the AI adds Method 2", async () => {
    const { quantFromFiles } = await import("../src/lib/quant-ai.js");
    reply = async (task) =>
      Object.keys(task.schema.properties.items.items.properties).includes("figure_box")
        ? { words: [{ kind: "question", q: "A does a work in 10 days, B in 15. Together?", a: "6 days", options: [], working: "LCM = 30 units\nA = 3/day, B = 2/day\n30/5 = 6 days", figure_box: [], source: 1, page: 1 }], provider: "Gemini", skipped: [] }
        : { words: [{ kind: "question", q: "A does a work in 10 days, B in 15. Together?", a: "6 days", options: ["5", "8", "12"], solution: "The AI's own long method", shortcut: "Product ÷ sum = 6", seconds: 8, formula: "", trick: "", draw: "", subject: "Quant", topic: "Time & Work", pattern: "Two workers", difficulty: 2, aiAnswered: false, similar: [] }], provider: "Gemini", skipped: [] };
    const r = await quantFromFiles({}, [{ kind: "pdf", name: "n.pdf", mediaType: "application/pdf", data: "x" }], "n.pdf", { variants: false, patterns: {} });
    expect(calls[1].text).toMatch(/Given method: LCM = 30 units \/ A = 3\/day/);
    expect(r.items[0]).toMatchObject({ solution: "LCM = 30 units\nA = 3/day, B = 2/day\n30/5 = 6 days", solutionFrom: "notes", shortcut: "Product ÷ sum = 6", a: "6 days" });
  });

  it("reads 'My solution:' lines into the learner's own solution", () => {
    const [it] = readQuant("## Quant › Percentage\nQ: 20% of 50?\nA: 10\nS: 50 × 0.2 = 10\nMy solution: 10% is 5\ndouble it → 10").items;
    expect(it).toMatchObject({ solution: "50 × 0.2 = 10", mySolution: "10% is 5\ndouble it → 10" });
    expect(makeQItem(it).mySolution).toBe("10% is 5\ndouble it → 10");
  });

  it("answers calculation questions offline with the built-in solver (free mode)", async () => {
    const { readNotes } = await import("../src/lib/quant-ai.js");
    const items = readNotes("Simplify: 3/4 + 5/6 × 2\nSolve 3x + 5 = 20\nSpeed = Distance / Time\nA train crosses a pole in 10 s. Speed?", "Typed");
    const solved = items.filter((x) => x.solver);
    expect(solved.map((x) => [x.q, x.a])).toEqual([["Simplify: 3/4 + 5/6 × 2", "29/12 (≈ 2.4167)"], ["Solve 3x + 5 = 20", "x = 5"]]);
    expect(solved[1].solution).toMatch(/3x = 15/);
    expect(items.some((x) => x.kind === "formula" && /Speed/.test(x.q))).toBe(true);
  });
});
