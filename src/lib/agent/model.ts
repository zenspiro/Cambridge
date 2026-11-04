// Workers AI as a ModelRun, shared by the agent's endpoint and the folder upload page.
import { modelJson, type ModelRun } from "./ai.ts";
import { reportError } from "../errors.ts";
import type { Db } from "../db.ts";
import { recordAiUse } from "./usage.ts";

type AiBinding = { run: (model: never, input: never) => Promise<unknown> };

/** null when the binding is missing; throws `{ unavailable: true }` where AI cannot run (local dev). */
export function makeModelRun(ai: AiBinding | undefined, model: string | undefined, where: string, db?: Db): ModelRun | null {
  if (!ai) return null;
  const name = model || "@cf/meta/llama-3.1-70b-instruct";
  return async (messages, schema, maxTokens) => {
    try {
      const raw = await ai.run(name as never, {
        messages,
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: schema },
      } as never);
      if (db) {
        // Tokens as Workers AI reports them, else estimated from the text (about 4 characters each).
        const u = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
        const inTok = Number(u?.prompt_tokens) || Math.ceil(JSON.stringify(messages).length / 4);
        const outTok = Number(u?.completion_tokens) || Math.ceil(JSON.stringify((raw as { response?: unknown })?.response ?? raw ?? "").length / 4);
        await recordAiUse(db, inTok, outTok);
      }
      return modelJson(raw);
    } catch (err) {
      // Local dev (wrangler dev --local) has the binding but no AI behind it.
      if (/run remotely|not available|not supported/i.test(String((err as Error)?.message))) throw Object.assign(new Error("ai_unavailable"), { unavailable: true });
      reportError(where, err);
      throw err;
    }
  };
}
