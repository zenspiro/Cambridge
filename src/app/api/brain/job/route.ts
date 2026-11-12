import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { cleanRunUrl } from "@/lib/agent/runs";
import { claimBrainRun, syllabusPdf } from "@/lib/brain/runs";
import { aiModels } from "@/lib/brain/aiSetup";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { brainLimits, paperJobPayload } from "@/lib/brain/paperJob";

// The brain script picks up its run: what to read (the subject and its syllabus PDF) and the models to use
// (Claude from the Worker var, Gemini as chosen on the AI setup page, else the Worker var). For an AI setup check,
// only the models. For a paper: what it is, its size, the scope and the reading stored so far. Signed only.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await claimBrainRun(a.db, jobId, cleanRunUrl(b?.runUrl, a.env.GITHUB_REPO));
  if (!params) return json({ error: "no_run" }, 409);
  const models = await aiModels(a.db, a.env);
  const limits = brainLimits();
  if (params.task === "check") return json({ task: "check", which: params.which, models: { claude: models.claude, gemini: models.gemini }, limits });
  if (params.task === "paper") {
    const payload = await paperJobPayload(a.db, a.env.FILES, params.docId, params.scope, params.batch, models, limits, params.reader, params.check, params.shadow, params.second);
    return payload ? json(payload) : json({ error: "no_paper" }, 404);
  }
  const y = await a.db
    .prepare(`SELECT code, valid_from_year, valid_to_year FROM syllabus WHERE id = ?1`)
    .bind(params.syllabusId)
    .first<{ code: string; valid_from_year: number; valid_to_year: number }>();
  const pdf = await syllabusPdf(a.db, params.syllabusId);
  if (!y || !pdf) return json({ error: "no_syllabus" }, 404);
  const years = y.valid_from_year === y.valid_to_year ? `${y.valid_from_year}` : `${y.valid_from_year} to ${y.valid_to_year}`;
  return json({
    task: params.task,
    subject: `${subjectLabel(await listSubjects(a.db), y.code)}, syllabus for ${years}`,
    pdfBytes: pdf.bytes,
    models: { claude: models.claude, gemini: models.gemini, drawing: models.drawing, reading: models.reading },
    limits,
  });
}
