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
