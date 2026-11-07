// What both AIs are asked when they copy a syllabus into a topic tree, and the answer shape they must keep to.
// One prompt for Claude and Gemini, so their answers can be compared. Pure, strip-only TypeScript.

export const TOPIC_SYSTEM = [
  "You copy the subject content of a Cambridge syllabus into a structured list for an exam practice platform.",
  "You copy; you never write. Every topic title, learning goal and note must be the syllabus's own words, in its own order.",
  "Code will check every word of your answer against the PDF's text, and an independent reader will copy the same syllabus.",
  "Anything not printed in the syllabus will be found and thrown away.",
].join(" ");

export function topicPrompt(subject: string): string {
  return `The attached PDF is the syllabus for ${subject}. Copy its subject content (the topics and what candidates should learn) into the JSON shape requested. Leave out everything else: the introduction, assessment details, practical guidance chapters, command words, glossaries and appendices.

topics: every numbered heading of the subject content, top-level sections included.
- number: exactly as printed ("1", "1.2", "C1.1"). Never invent numbers.
- title: exactly as printed, without "continued".
- parent: the number of the heading it sits under, or "" for a top-level section.
When the syllabus prints Core and Extended content as separate lists with their own numbers (for example C1.1 and E1.1), keep both lists as separate topics with those numbers.

goals: every learning goal (statement of what candidates should know, understand or be able to do), each under the deepest heading it belongs to.
- topic: that heading's number.
- number: the goal's number as printed ("1", "12"), or "" when the syllabus does not number its goals.
- text: exactly as printed. Keep sub-points such as (a), (b) inside the one goal, separated by "; ". Write equations in plain text, for example "v = s / t".
- tier: "core" when listed under Core, "supplement" when listed under Supplement or Extended, "all" when the syllabus does not split them.
- notes: the syllabus's own notes or guidance printed beside or below this goal, word for word, else "".

Keep the syllabus's order. Do not summarise, merge, split, reword or correct anything.`;
}

export function retryPrompt(subject: string, notes: string): string {
  return `${topicPrompt(subject)}

Your earlier answer was checked against the PDF's text and against an independent reader's copy. These points need another look:
${notes}

Read the syllabus again and give the complete corrected list (all topics and goals, not only the changed ones). Where the independent reader was wrong, keep the syllabus's wording.`;
}

/** JSON Schema for Claude's structured output (flat lists: recursive schemas are not allowed). */
export const TOPIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topics", "goals"],
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "title", "parent"],
        properties: { number: { type: "string" }, title: { type: "string" }, parent: { type: "string" } },
      },
    },
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "number", "text", "tier", "notes"],
        properties: {
          topic: { type: "string" },
          number: { type: "string" },
          text: { type: "string" },
          tier: { type: "string", enum: ["core", "supplement", "all"] },
          notes: { type: "string" },
        },
      },
    },
  },
} as const;

/** The same shape in Gemini's schema dialect (OpenAPI subset, upper-case types, fixed property order). */
export const TOPIC_SCHEMA_GEMINI = {
  type: "OBJECT",
  required: ["topics", "goals"],
  propertyOrdering: ["topics", "goals"],
  properties: {
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["number", "title", "parent"],
        propertyOrdering: ["number", "title", "parent"],
        properties: { number: { type: "STRING" }, title: { type: "STRING" }, parent: { type: "STRING" } },
      },
    },
    goals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["topic", "number", "text", "tier", "notes"],
        propertyOrdering: ["topic", "number", "text", "tier", "notes"],
        properties: {
          topic: { type: "STRING" },
          number: { type: "STRING" },
          text: { type: "STRING" },
          tier: { type: "STRING", enum: ["core", "supplement", "all"] },
          notes: { type: "STRING" },
        },
      },
    },
  },
} as const;

// ---------- Reading the papers (step 2b) ----------

export const PAPER_SYSTEM = [
  "You copy a Cambridge exam paper (a question paper or its mark scheme) into a structured list for an exam practice platform.",
  "You copy; you never write. Every question, option, mark scheme answer and note must be the paper's own words, in its own order.",
  "Code will check every word and number of your answer against the PDF's text, and an independent reader will copy the same paper.",
].join(" ");

export function paperPrompt(kind: "qp" | "ms", paper: string, only: readonly string[] = []): string {
  const what = kind === "qp"
    ? `items: every question and question part that asks something, in order.
- number: as printed, joined: "1", "1(a)", "3(b)(ii)". A question with parts has no item of its own unless it asks something itself; put its opening words (the stem) at the start of its first part's text.
- page: the page it starts on (the PDF's page number, 1 for the cover).
- text: the wording exactly as printed, including any table as plain lines ("Time / s: 0, 2, 4"). Equations in plain text ("v = s / t").
- marks: the [marks] printed for it, or null when none are printed.
- options: for multiple choice, each option as { letter, text } exactly as printed; else [].
- answerLines: how many answer lines are printed for it (0 when none).
- figures: the ids of the figures (diagrams, graphs, photographs) it shows, from the figures list.
- guidance: "".
figures: every figure in the paper as { id, page, caption }: id "F1", "F2" in order, caption the paper's own label ("Fig. 2.1") and what it shows in a few words.
totalMarks: the total printed on the cover ("The total mark for this paper is 80"), or null.`
    : `items: every mark scheme row, in order.
- number: the question part as printed, joined: "1", "1(a)", "3(b)(ii)".
- page: the page it is on (the PDF's page number).
- text: the answer and mark points exactly as printed (one point per line, with its mark code such as B1, M1, A1 when printed).
- marks: the marks for that row as printed, or null.
- options: [] (for a multiple choice key, put the letter in text).
- answerLines: 0.
- figures: [] unless the mark scheme prints a figure.
- guidance: the guidance printed for that row (accept, allow, ignore), word for word, else "".
figures: any figure the mark scheme prints, as { id, page, caption }, else [].
totalMarks: the maximum mark printed, or null.`;
  const scope = only.length ? `\n\nOnly copy these items: ${only.join(", ")}. Leave every other item out.` : "";
  return `The attached PDF is ${paper}. Copy it into the JSON shape requested. Leave out the cover instructions, blank pages and copyright notices.

${what}

Keep the paper's order. Do not summarise, merge, split, reword, correct or answer anything.${scope}`;
}

const PAPER_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["number", "page", "text", "marks", "options", "answerLines", "figures", "guidance"],
  properties: {
    number: { type: "string" },
    page: { type: "integer" },
    text: { type: "string" },
    marks: { type: ["integer", "null"] },
    options: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["letter", "text"], properties: { letter: { type: "string" }, text: { type: "string" } } },
    },
    answerLines: { type: "integer" },
    figures: { type: "array", items: { type: "string" } },
    guidance: { type: "string" },
  },
} as const;

const PAPER_FIGURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "page", "caption"],
  properties: { id: { type: "string" }, page: { type: "integer" }, caption: { type: "string" } },
} as const;

/** JSON Schema for Claude's reading of a paper. */
export const PAPER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["totalMarks", "items", "figures"],
  properties: {
    totalMarks: { type: ["integer", "null"] },
    items: { type: "array", items: PAPER_ITEM_SCHEMA },
    figures: { type: "array", items: PAPER_FIGURE_SCHEMA },
  },
} as const;

/** The same shape in Gemini's schema dialect (nullable instead of type lists). */
export const PAPER_SCHEMA_GEMINI = {
  type: "OBJECT",
  required: ["totalMarks", "items", "figures"],
  properties: {
    totalMarks: { type: "INTEGER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["number", "page", "text", "marks", "options", "answerLines", "figures", "guidance"],
        properties: {
          number: { type: "STRING" },
          page: { type: "INTEGER" },
          text: { type: "STRING" },
          marks: { type: "INTEGER", nullable: true },
          options: { type: "ARRAY", items: { type: "OBJECT", required: ["letter", "text"], properties: { letter: { type: "STRING" }, text: { type: "STRING" } } } },
          answerLines: { type: "INTEGER" },
          figures: { type: "ARRAY", items: { type: "STRING" } },
          guidance: { type: "STRING" },
        },
      },
    },
    figures: { type: "ARRAY", items: { type: "OBJECT", required: ["id", "page", "caption"], properties: { id: { type: "STRING" }, page: { type: "INTEGER" }, caption: { type: "STRING" } } } },
  },
} as const;

export const DRAW_SYSTEM = [
  "You redraw figures from a Cambridge exam paper as clean SVG for an exam practice platform's review screen, where they are compared by eye with the original.",
  "Draw what is printed: the same shapes, labels, values, scales and proportions. Never add, correct or answer anything.",
  "Use only plain SVG drawing elements (svg, g, path, line, polyline, polygon, rect, circle, ellipse, text, tspan, defs, marker) with presentation attributes; no style elements, scripts, images, links or fonts other than sans-serif.",
].join(" ");

export function drawPrompt(paper: string, figures: readonly { id: string; page: number; caption: string }[]): string {
  return `The attached PDF is ${paper}. Redraw each of these figures as its own SVG (with a viewBox, black lines on white, labels as text):
${figures.map((f) => `- ${f.id}: page ${f.page}${f.caption ? `, ${f.caption}` : ""}`).join("\n")}

Answer with every listed figure, each as { id, svg }.`;
}

export const DRAW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["figures"],
  properties: {
    figures: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "svg"], properties: { id: { type: "string" }, svg: { type: "string" } } },
    },
  },
} as const;
