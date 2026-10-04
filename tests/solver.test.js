import { describe, expect, it } from "vitest";
import { checkSteps, evaluate, fmt, sameAnswer, solveQuestion } from "../src/lib/solver.js";

const ans = (q) => solveQuestion(q)?.answer ?? null;

describe("built-in solver: calculation", () => {
  it("evaluates exam-style maths", () => {
    expect(evaluate("(10 × 15)/(10 + 15)")).toBe(6);
    expect(evaluate("√144 + ∛125")).toBe(17);
    expect(evaluate("25% of 480")).toBe(120);
    expect(evaluate("3/4 + 5/6 × 2")).toBeCloseTo(29 / 12);
    expect(evaluate("2(3 + 4)²")).toBe(98);
    expect(evaluate("1,20,000 ÷ 4")).toBe(30000);
    expect(evaluate("5!")).toBe(120);
    expect(evaluate("[12 − {3 + (4 − 2)}] × 2")).toBe(14);
    expect(evaluate("speed of the train")).toBeNull();
    expect(fmt(29 / 12)).toBe("29/12 (≈ 2.4167)");
    expect(fmt(2.5)).toBe("2.5");
    expect(fmt(6.0000000001)).toBe("6");
  });

  it("answers pure-calculation questions with steps", () => {
    expect(ans("Simplify: 3/4 + 5/6 × 2")).toBe("29/12 (≈ 2.4167)");
    expect(ans("Find the value of √144 + ∛125.")).toBe("17");
    expect(ans("What is 25% of 480?")).toBe("120");
    expect(ans("(256)^(1/4) × 9^(1/2) = ?")).toBe("12");
    expect(ans("What percent of 80 is 20?")).toBe("25%");
    expect(ans("30 is what percentage of 120?")).toBe("25%");
    expect(ans("The price increased from 400 to 500. Find the percentage increase.")).toBe("25% increase");
    expect(ans("Find the HCF of 12, 18 and 24.")).toBe("6");
    expect(ans("LCM of 12, 15 and 20 is")).toBe("60");
    expect(solveQuestion("LCM of 12 and 18?").steps).toEqual(["12 = 2 × 2 × 3", "18 = 2 × 3 × 3", "LCM = product of the highest powers of all primes = 36"]);
    expect(ans("Find the average of 12, 15, 18 and 23.")).toBe("17");
    expect(ans("Find the simple interest on ₹5000 at 8% per annum for 3 years.")).toBe("₹1200");
    expect(ans("Find the amount on Rs 2000 at 10% simple interest for 2 years.")).toBe("₹2400");
    expect(ans("Find the compound interest on ₹10,000 at 10% per annum for 2 years.")).toBe("₹2100");
    expect(ans("What is the compound interest on ₹8000 at 10% per annum for 1 year compounded half-yearly?")).toBe("₹820");
  });

  it("solves equations", () => {
    expect(ans("Solve: 3x + 5 = 20")).toBe("x = 5");
    expect(ans("If 2(x − 3) = x + 4, find x.")).toBe("x = 10");
    expect(ans("Solve x² − 5x + 6 = 0")).toBe("x = 3 or 2");
    expect(ans("x^2 + 4 = 0, find x")).toBe("No real roots");
    expect(ans("If x + y = 10 and x − y = 2, find x.")).toBe("6");
    expect(ans("2a + 3b = 12 and a − b = 1. Find a and b.")).toBe("a = 3, b = 2");
  });

  it("leaves word problems to the AI (never guesses)", () => {
    expect(solveQuestion("A train 150 m long crosses a pole in 10 seconds. Find its speed in km/h.")).toBeNull();
    expect(solveQuestion("A can do a work in 10 days and B in 15 days. In how many days will they finish it together?")).toBeNull();
    expect(solveQuestion("Find the rate of interest if SI on ₹2000 for 2 years is ₹400.")).toBeNull();
    expect(solveQuestion("In a certain code, CAT is written as DBU. How is DOG written?")).toBeNull();
    expect(solveQuestion("Some pens are books. All books are copies. Conclusions: …")).toBeNull();
  });

  it("compares answers by their number", () => {
    expect(sameAnswer("6 days", "6")).toBe(true);
    expect(sameAnswer("₹1,200", "1200")).toBe(true);
    expect(sameAnswer("29/12", "2.4167")).toBe(true);
    expect(sameAnswer("12 km/h", "15")).toBe(false);
    expect(sameAnswer("Kautilya", "6")).toBeNull();
  });
});

describe("built-in solver: checking written solutions", () => {
  it("re-calculates each a = b and reports the wrong ones", () => {
    const good = checkSteps("A does 1/10 and B 1/15 a day.\nTogether 1/10 + 1/15 = 1/6 of the work per day, so 6 days.\n(10 × 15)/(10 + 15) = 150/25 = 6 days.");
    expect(good).toEqual({ checked: 3, wrong: [] });
    const bad = checkSteps("SP = 125 × 0.8 = 90\nProfit% = 10/100 × 100 = 10%");
    expect(bad.checked).toBe(2);
    expect(bad.wrong).toEqual([{ line: "SP = 125 × 0.8 = 90", left: "125 × 0.8", right: "90", expected: "100" }]);
    expect(checkSteps("r/(100 + r) × 100 = 25/125 × 100 = 20%").wrong).toEqual([]);
    expect(checkSteps("√2 ≈ 1.41").checked).toBe(0);
    expect(checkSteps("Speed = Distance / Time").checked).toBe(0);
  });
});

describe("step checker: labels, words and percentages", () => {
  it("ignores labels, reads 'of', and accepts '21 = 21% of …' shorthand", () => {
    const r = checkSteps("Year 1 interest = 10% of 10000 = 1000\nYear 2 interest = 10% of 11000 = 1200\nCI = 1000 + 1100 = 2100\nSuccessive % : 10 + 10 + (10 × 10)/100 = 21% of 10000 = 2100");
    expect(r.wrong.map((w) => `${w.left} → ${w.expected}`)).toEqual(["10% of 11000 → 1100"]);
    expect(r.checked).toBe(5);
  });
});
