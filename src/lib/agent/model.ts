// Workers AI as a ModelRun, shared by the agent's endpoint and the folder upload page.
import { modelJson, type ModelRun } from "./ai.ts";
import { reportError } from "../errors.ts";

type AiBinding = { run: (model: never, input: never) => Promise<unknown> };

/** null when the binding is missing; throws `{ unavailable: true }` where AI cannot run (local dev). */
export function makeModelRun(ai: AiBinding | undefined, model: string | undefined, where: string): ModelRun | null {
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
      return modelJson(raw);
    } catch (err) {
      // Local dev (wrangler dev --local) has the binding but no AI behind it.
      if (/run remotely|not available|not supported/i.test(String((err as Error)?.message))) throw Object.assign(new Error("ai_unavailable"), { unavailable: true });
      reportError(where, err);
      throw err;
    }
  };
}
