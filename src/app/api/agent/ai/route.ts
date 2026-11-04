import { agentRequest, json, parseJson } from "@/lib/agent/api";
import { aiTask } from "@/lib/agent/aiTask";
import { makeModelRun } from "@/lib/agent/model";

// The agent asks for judgement here (which folders, what files are, a run summary). Signed only.
// Prompts and checks live in src/lib/agent/ai.ts; the agent sends names and counts, never prompts.
// 503 means Workers AI is not available: the agent carries on with its rules.
export async function POST(request: Request) {
  const a = await agentRequest(request, 64 * 1024);
  if (!a.ok) return a.response;
  const run = makeModelRun(a.env.AI as never, a.env.AI_MODEL, "agent.ai");
  if (!run) return json({ error: "ai_unavailable" }, 503);
  const r = await aiTask(a.db, parseJson(a.body), run);
  return r.ok ? json(r.data) : json({ error: r.error }, r.status);
}
