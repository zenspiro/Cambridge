import { agentRequest, json, parseJson } from "@/lib/agent/api";
import { aiTask } from "@/lib/agent/aiTask";
import { modelJson, type ModelRun } from "@/lib/agent/ai";
import { reportError } from "@/lib/errors";

// The agent asks for judgement here (which folders, what files are, a run summary). Signed only.
// Prompts and checks live in src/lib/agent/ai.ts; the agent sends names and counts, never prompts.
// 503 means Workers AI is not available: the agent carries on with its rules.
export async function POST(request: Request) {
  const a = await agentRequest(request, 64 * 1024);
  if (!a.ok) return a.response;
  const ai = a.env.AI;
  if (!ai) return json({ error: "ai_unavailable" }, 503);
  const model = a.env.AI_MODEL || "@cf/meta/llama-3.1-70b-instruct";
  const run: ModelRun = async (messages, schema, maxTokens) => {
    try {
      const raw = await ai.run(model as Parameters<typeof ai.run>[0], {
        messages,
        max_tokens: maxTokens,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: schema },
      } as never);
      return modelJson(raw);
    } catch (err) {
      // Local dev (wrangler dev --local) has the binding but no AI behind it.
      if (/run remotely|not available|not supported/i.test(String((err as Error)?.message))) throw Object.assign(new Error("ai_unavailable"), { unavailable: true });
      reportError("agent.ai", err);
      throw err;
    }
  };
  const r = await aiTask(a.db, parseJson(a.body), run);
  return r.ok ? json(r.data) : json({ error: r.error }, r.status);
}
