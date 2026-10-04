// Saved questions as one list in a chosen order (newest added first, weakest first…), with day headings when the order
// is by date. Shared by Maths, Reasoning and GK. Pure; unit-tested.
import { todayISO } from "./words.js";

/** [key, label] — the orders offered. */
export const SORTS = [
  ["newest", "🆕 Newest added"],
  ["oldest", "Oldest added"],
  ["revised", "Recently revised"],
  ["weakest", "Weakest first (most mistakes)"],
  ["due", "Due for revision first"],
  ["hardest", "Hardest first"],
  ["az", "A → Z"],
];
export const SORT_KEYS = SORTS.map(([k]) => k);

const added = (i) => String(i.addedAt || "");
const byText = (a, b) => String(a.q || "").localeCompare(String(b.q || ""), "en", { sensitivity: "base" });

/** A copy of `items` in the chosen order (ties: newest added first). */
export function sortItems(items, sort = "newest") {
  const newest = (a, b) => added(b).localeCompare(added(a));
  const cmp = {
    newest,
    oldest: (a, b) => added(a).localeCompare(added(b)) || byText(a, b),
    revised: (a, b) => String(b.lastReviewed || "").localeCompare(String(a.lastReviewed || "")) || newest(a, b),
    weakest: (a, b) => (b.lapses || 0) - (a.lapses || 0) || (a.box || 0) - (b.box || 0) || newest(a, b),
    due: (a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || newest(a, b),
    hardest: (a, b) => (b.difficulty || 0) - (a.difficulty || 0) || newest(a, b),
    az: byText,
  }[sort] || newest;
  return [...items].sort(cmp);
}

/** "Today", "Yesterday", or "Sat, 3 Oct" (with the year when it isn't this year). */
export function dayLabel(iso, now = new Date()) {
  if (!iso) return "Built in";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const day = todayISO(d);
  if (day === todayISO(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === todayISO(y)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/**
 * The list split into sections: by the day each was added (newest / oldest orders), else one section.
 * Returns [{label, items}].
 */
export function sections(items, sort, now = new Date()) {
  if (sort !== "newest" && sort !== "oldest") return [{ label: "", items }];
  const out = [];
  for (const it of items) {
    const label = it.book || it.bank ? "Built in" : dayLabel(it.addedAt, now);
    if (out.at(-1)?.label === label) out.at(-1).items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}
