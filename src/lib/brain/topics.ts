// The topic tree (Phase 2 step 1): the shape of a syllabus's subject content, and the checks that let it go live
// without a subject expert (owner, 5 Nov 2026). The AI only copies; code checks the copy:
// - every topic title, goal and note must be found in the syllabus PDF's own text (`checkWords`),
// - topic numbers must be whole (parents exist, no gaps or repeats), goals unique per topic (`checkNumbers`),
// - every numbered topic heading in the PDF (like "1.2 Motion") must be in the tree (`missingHeadings`),
// - a second AI's independent copy must agree (`compareDrafts`); where they differ, the word check decides who
//   copied right, and only differences the text cannot settle count against the tree.
// Pure and strip-only TypeScript: the brain script on GitHub Actions and the Worker both use it.
import { BRAIN } from "../config.ts";

export type Tier = "core" | "supplement" | "all";
export const TIERS: readonly Tier[] = ["core", "supplement", "all"];

/** A topic as the AI gives it: flat, the parent named by its number ("" at the top). */
export type DraftTopic = { number: string; title: string; parent: string };
export type DraftGoal = { topic: string; number: string; text: string; tier: Tier; notes: string };
export type Draft = { topics: DraftTopic[]; goals: DraftGoal[] };

export type Problem = { kind: "words" | "numbers" | "missing" | "shape"; where: string; detail: string };
export type Disagreement = { where: string; claude: string; gemini: string };

const TOPIC_NO = /^[A-Z]{0,2}\d{1,3}(\.\d{1,3}){0,3}$/;
const GOAL_NO = /^(\d{1,3}[a-z]?|[a-z]|[ivx]{1,5})?$/;

function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function block(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** An AI's answer made safe: wrong shapes are dropped (and named), text is trimmed and capped. */
export function cleanDraft(raw: unknown): { draft: Draft; problems: Problem[] } {
  const problems: Problem[] = [];
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const topics: DraftTopic[] = [];
  const goals: DraftGoal[] = [];
  const rawTopics = Array.isArray(o.topics) ? o.topics : [];
  const rawGoals = Array.isArray(o.goals) ? o.goals : [];
  if (!rawTopics.length) problems.push({ kind: "shape", where: "tree", detail: "no topics" });
  for (const t of rawTopics.slice(0, BRAIN.maxTopics)) {
    const r = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const number = line(r.number, 20)?.replace(/\.$/, "") ?? "";
    const title = (line(r.title, BRAIN.maxTitle) ?? "").replace(/\s+continued$/i, "");
    const parent = line(r.parent, 20)?.replace(/\.$/, "") ?? "";
    if (!TOPIC_NO.test(number) || !title || (parent && !TOPIC_NO.test(parent))) {
      problems.push({ kind: "shape", where: number || "topic", detail: "topic without a proper number or title" });
      continue;
    }
    topics.push({ number, title, parent });
  }
  for (const g of rawGoals.slice(0, BRAIN.maxGoals)) {
    const r = g && typeof g === "object" ? (g as Record<string, unknown>) : {};
    const topic = line(r.topic, 20)?.replace(/\.$/, "") ?? "";
    const number = line(r.number, 10)?.replace(/[.)]$/, "") ?? "";
    const text = block(r.text, BRAIN.maxGoalText);
    const tier = TIERS.find((x) => x === r.tier);
    if (!TOPIC_NO.test(topic) || !GOAL_NO.test(number) || !text || !tier) {
      problems.push({ kind: "shape", where: topic ? `${topic} goal ${number}` : "goal", detail: "goal without a topic, wording or tier" });
      continue;
    }
    goals.push({ topic, number, text, tier, notes: block(r.notes, BRAIN.maxNotes) });
  }
  if (rawTopics.length > BRAIN.maxTopics || rawGoals.length > BRAIN.maxGoals) {
    problems.push({ kind: "shape", where: "tree", detail: "more topics or goals than allowed; the rest were left out" });
  }
  return { draft: { topics, goals }, problems };
}

// ---------- Word check ----------

/** Letters and digits only, lower case, accents and symbols removed: what the word check compares. */
export function squash(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type TextIndex = { text: string; grams: Set<string>; chars: number };

/** The syllabus text ready for checking: every run of `gramLength` letters and digits. */
export function textIndex(pages: readonly string[]): TextIndex {
  const text = squash(pages.join(" "));
  const n = BRAIN.gramLength;
  const grams = new Set<string>();
  for (let i = 0; i + n <= text.length; i++) grams.add(text.slice(i, i + n));
  return { text, grams, chars: text.length };
}

/**
 * Share of a wording found in the syllabus text (0 to 1). A character counts when any run of `gramLength`
 * characters around it is in the text, so line breaks and two-column layouts do not matter, but words the
 * syllabus never prints do. Short wordings must appear whole.
 */
export function coverage(idx: TextIndex, wording: string): number {
  const s = squash(wording);
  if (!s) return 1;
  const n = BRAIN.gramLength;
  if (s.length < n) return idx.text.includes(s) ? 1 : 0;
  const covered = new Uint8Array(s.length);
  for (let i = 0; i + n <= s.length; i++) {
    if (idx.grams.has(s.slice(i, i + n))) covered.fill(1, i, i + n);
  }
  let c = 0;
  for (const x of covered) c += x;
  return c / s.length;
}

/** Each goal's label, "1.2 goal 3" (unnumbered goals by their place in the topic: "3 goal #2"). Same order as d.goals. */
export function goalLabels(d: Draft): string[] {
  const counts = new Map<string, number>();
  return d.goals.map((g) => {
    const n = (counts.get(g.topic) ?? 0) + 1;
    counts.set(g.topic, n);
    return `${g.topic} goal ${g.number || `#${n}`}`;
  });
}

/** Every title, goal and note not found in the syllabus text. */
export function checkWords(d: Draft, idx: TextIndex): Problem[] {
  const out: Problem[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}% found in the syllabus`;
  const labels = goalLabels(d);
  for (const t of d.topics) {
    const c = coverage(idx, t.title);
    if (c < BRAIN.minWordCover) out.push({ kind: "words", where: `${t.number} ${t.title}`, detail: `title ${pct(c)}` });
  }
  d.goals.forEach((g, i) => {
    const c = coverage(idx, g.text);
    if (c < BRAIN.minWordCover) out.push({ kind: "words", where: labels[i]!, detail: `wording ${pct(c)}: ${g.text.slice(0, 120)}` });
    if (g.notes) {
      const n = coverage(idx, g.notes);
      if (n < BRAIN.minWordCover) out.push({ kind: "words", where: labels[i]!, detail: `notes ${pct(n)}` });
    }
  });
  return out;
}

// ---------- Numbering ----------

const lastPart = (n: string) => Number(n.split(".").pop()!.replace(/^[A-Z]+/, ""));
const prefixOf = (n: string) => (n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n.replace(/\d+$/, ""));

/** Consecutive whole numbers, any start: [3,4,5] yes, [1,3] or [2,2] no. */
function runs(nums: number[]): boolean {
  const s = [...nums].sort((a, b) => a - b);
  return s.every((x, i) => i === 0 || x === s[i - 1]! + 1);
}

export function checkNumbers(d: Draft): Problem[] {
  const out: Problem[] = [];
  const numbers = new Set<string>();
  for (const t of d.topics) {
    if (numbers.has(t.number)) out.push({ kind: "numbers", where: t.number, detail: "topic number used twice" });
    numbers.add(t.number);
  }
  for (const t of d.topics) {
    if (t.parent && !numbers.has(t.parent)) out.push({ kind: "numbers", where: t.number, detail: `its parent ${t.parent} is not in the tree` });
    if (t.parent && t.number.includes(".") && prefixOf(t.number) !== t.parent) {
      out.push({ kind: "numbers", where: t.number, detail: `sits under ${t.parent}, but its number says ${prefixOf(t.number)}` });
    }
  }
  // Siblings (same parent and same letter prefix) are numbered without gaps or repeats.
  const groups = new Map<string, number[]>();
  for (const t of d.topics) {
    const key = `${t.parent}|${prefixOf(t.number)}`;
    groups.set(key, [...(groups.get(key) ?? []), lastPart(t.number)]);
  }
  for (const [key, nums] of groups) {
    if (!runs(nums)) out.push({ kind: "numbers", where: key.split("|")[0] || "top level", detail: `topic numbers have a gap or a repeat (${[...nums].sort((a, b) => a - b).join(", ")})` });
  }
  const byTopic = new Map<string, DraftGoal[]>();
  for (const g of d.goals) {
    if (!numbers.has(g.topic)) out.push({ kind: "numbers", where: `${g.topic} goal ${g.number}`, detail: "its topic is not in the tree" });
    byTopic.set(g.topic, [...(byTopic.get(g.topic) ?? []), g]);
  }
  for (const [topic, gs] of byTopic) {
    const numbered = gs.filter((g) => g.number);
    const seen = new Set<string>();
    for (const g of numbered) {
      if (seen.has(g.number)) out.push({ kind: "numbers", where: `${topic} goal ${g.number}`, detail: "goal number used twice" });
      seen.add(g.number);
    }
    const whole = numbered.filter((g) => /^\d+$/.test(g.number)).map((g) => Number(g.number));
    if (whole.length > 1 && !runs(whole)) out.push({ kind: "numbers", where: topic, detail: `goal numbers have a gap (${whole.sort((a, b) => a - b).join(", ")})` });
  }
  const hasChild = new Set(d.topics.map((t) => t.parent));
  for (const t of d.topics) {
    if (!hasChild.has(t.number) && !byTopic.has(t.number)) out.push({ kind: "numbers", where: `${t.number} ${t.title}`, detail: "topic with no goals and no subtopics" });
  }
  return out;
}

/**
 * Numbered topic headings printed in the syllabus ("1.2 Motion", "C1.1 Types of number") that the tree lacks.
 * Only sections the tree has are looked at, so chapters about the exam itself are never asked for.
 */
export function missingHeadings(d: Draft, pages: readonly string[]): Problem[] {
  const have = new Set(d.topics.map((t) => t.number));
  const sections = new Set(d.topics.filter((t) => !t.parent).map((t) => t.number));
  const found = new Map<string, string>();
  const re = /^([A-Z]{0,2}\d{1,3})\.(\d{1,3}) ([A-Z][^.]{2,120})$/;
  for (const page of pages) {
    for (const l of page.split("\n")) {
      const m = re.exec(l.trim());
      if (!m || /\.{4,}|\s\d+$/.test(l)) continue; // contents page lines end in dots or a page number
      const number = `${m[1]}.${m[2]}`;
      if (sections.has(m[1]!) && !have.has(number) && !found.has(number)) found.set(number, m[3]!.replace(/\s+continued$/i, ""));
    }
  }
  return [...found].map(([number, title]) => ({ kind: "missing" as const, where: `${number} ${title}`, detail: "heading in the syllabus but not in the tree" }));
}

// ---------- Comparing two drafts ----------

function pairs(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 2 <= s.length; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

/** How alike two wordings are (0 to 1), on letters and digits only (Dice over character pairs). */
export function similarity(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const px = pairs(x);
  let shared = 0;
  for (const [k, n] of pairs(y)) shared += Math.min(n, px.get(k) ?? 0);
  return (2 * shared) / (x.length - 1 + y.length - 1);
}

function goalKeys(d: Draft): Map<string, DraftGoal> {
  const labels = goalLabels(d);
  return new Map(d.goals.map((g, i) => [labels[i]!, g]));
}

export type Comparison = { agreement: number; matched: number; total: number; disagreements: Disagreement[]; settled: number };

/**
 * Compares Claude's draft with Gemini's. Topics are paired by number, goals by topic and number (or position when
 * unnumbered). A difference the syllabus text settles (Claude's wording found, Gemini's not) is counted as agreed
 * ("settled"); anything else is a disagreement. With no readable text, nothing can be settled.
 */
export function compareDrafts(claude: Draft, gemini: Draft, idx: TextIndex | null): Comparison {
  const disagreements: Disagreement[] = [];
  let settled = 0;
  const textOk = (s: string) => idx !== null && coverage(idx, s) >= BRAIN.minWordCover;
  const settles = (mine: string, theirs: string) => textOk(mine) && !textOk(theirs);
  const gTopics = new Map(gemini.topics.map((t) => [t.number, t]));
  const cTopics = new Map(claude.topics.map((t) => [t.number, t]));
  let total = 0;
  let matched = 0;
  for (const t of claude.topics) {
    total++;
    const o = gTopics.get(t.number);
    if (o && similarity(t.title, o.title) >= BRAIN.sameText) matched++;
    else if (settles(t.title, o?.title ?? "")) { matched++; settled++; }
    else disagreements.push({ where: `topic ${t.number}`, claude: t.title, gemini: o?.title ?? "(not there)" });
  }
  for (const o of gemini.topics) {
    if (cTopics.has(o.number)) continue;
    total++;
    if (idx === null || textOk(o.title)) disagreements.push({ where: `topic ${o.number}`, claude: "(not there)", gemini: o.title });
    else { matched++; settled++; }
  }
  const cg = goalKeys(claude);
  const gg = goalKeys(gemini);
  for (const [k, g] of cg) {
    total++;
    const o = gg.get(k);
    const where = k;
    if (o && similarity(g.text, o.text) >= BRAIN.sameText && o.tier === g.tier) matched++;
    else if (o && o.tier !== g.tier && similarity(g.text, o.text) >= BRAIN.sameText) disagreements.push({ where, claude: `${g.tier}: ${g.text}`, gemini: `${o.tier}: ${o.text}` });
    else if (settles(g.text, o?.text ?? "")) { matched++; settled++; }
    else disagreements.push({ where, claude: g.text, gemini: o?.text ?? "(not there)" });
  }
  for (const [k, o] of gg) {
    if (cg.has(k)) continue;
    total++;
    if (idx === null || textOk(o.text)) disagreements.push({ where: k, claude: "(not there)", gemini: o.text });
    else { matched++; settled++; }
  }
  return { agreement: total ? matched / total : 0, matched, total, disagreements, settled };
}

// ---------- The verdict and the stored tree ----------

export type TreeReport = {
  attempts: number;
  textChecked: boolean;
  problems: Problem[];
  agreement: number;
  disagreements: Disagreement[];
  settled: number;
  models: { claude: string; gemini: string };
  /** Words in and out, as the providers report them. */
  usage: { claudeIn: number; claudeOut: number; geminiIn: number; geminiOut: number };
};

/** Ready only when every check passed and the two AIs agree closely enough. */
export function isReady(r: Pick<TreeReport, "textChecked" | "problems" | "agreement">): boolean {
  return r.textChecked && r.problems.length === 0 && r.agreement >= BRAIN.minAgreement;
}

/** Plain-word problems for Claude's second try, which is told what the checks found. */
export function retryNotes(problems: readonly Problem[], disagreements: readonly Disagreement[], max = 80): string {
  const lines = [
    ...problems.map((p) => `- ${p.where}: ${p.detail}`),
    ...disagreements.map((d) => `- ${d.where}: you wrote "${d.claude.slice(0, 200)}"; an independent reader wrote "${d.gemini.slice(0, 200)}"`),
  ];
  return lines.slice(0, max).join("\n") + (lines.length > max ? `\n- and ${lines.length - max} more like these` : "");
}

/** Goals with something still open (a failed word check or a disagreement), by "topic goal number". */
export function flaggedGoals(r: Pick<TreeReport, "problems" | "disagreements">): Set<string> {
  return new Set([...r.problems.map((p) => p.where), ...r.disagreements.map((d) => d.where)]);
}

export type TreeNode = { number: string; title: string; children: TreeNode[]; goals: (DraftGoal & { flag: boolean })[] };

/** The flat draft as a tree for display (topics in syllabus number order). */
export function buildTree(d: Draft, flagged: ReadonlySet<string> = new Set()): TreeNode[] {
  const nodes = new Map<string, TreeNode>(d.topics.map((t) => [t.number, { number: t.number, title: t.title, children: [], goals: [] }]));
  const labels = goalLabels(d);
  d.goals.forEach((g, i) => nodes.get(g.topic)?.goals.push({ ...g, flag: flagged.has(labels[i]!) }));
  const roots: TreeNode[] = [];
  for (const t of d.topics) {
    const n = nodes.get(t.number)!;
    const p = t.parent ? nodes.get(t.parent) : undefined;
    (p ? p.children : roots).push(n);
  }
  const order = (a: TreeNode, b: TreeNode) => a.number.localeCompare(b.number, "en", { numeric: true });
  const sortAll = (list: TreeNode[]) => {
    list.sort(order);
    for (const n of list) sortAll(n.children);
  };
  sortAll(roots);
  return roots;
}
