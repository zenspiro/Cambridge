// The AI meter: every Workers AI question counted per UTC day with its tokens and estimated
// neurons. Recording never breaks a question: a failed write is ignored.
import { AI_USAGE } from "../config.ts";
import type { Db } from "../db.ts";

export const usageDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function estimateNeurons(input: number, output: number): number {
  return (input * AI_USAGE.neuronsPerMillionInput + output * AI_USAGE.neuronsPerMillionOutput) / 1_000_000;
}

export async function recordAiUse(db: Db, input: number, output: number, now = Date.now()): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO ai_usage (day, calls, input_tokens, output_tokens, neurons, updated_at) VALUES (?1, 1, ?2, ?3, ?4, ?5)
                ON CONFLICT (day) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + ?2, output_tokens = output_tokens + ?3,
                  neurons = neurons + ?4, updated_at = ?5`)
      .bind(usageDay(now), input, output, estimateNeurons(input, output), now)
      .run();
  } catch {
    // the meter is a help, never a reason for a question to fail
  }
}

export type AiUsageToday = { calls: number; neurons: number; share: number };

export async function aiUsageToday(db: Db, now = Date.now()): Promise<AiUsageToday> {
  try {
    const r = await db.prepare(`SELECT calls, neurons FROM ai_usage WHERE day = ?1`).bind(usageDay(now)).first<{ calls: number; neurons: number }>();
    const neurons = Math.round(r?.neurons ?? 0);
    return { calls: r?.calls ?? 0, neurons, share: Math.round((neurons / AI_USAGE.freeNeuronsPerDay) * 100) };
  } catch {
    return { calls: 0, neurons: 0, share: 0 };
  }
}
