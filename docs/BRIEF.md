# Project Brief: Cambridge Exam Prep Platform

Handover brief for Claude Code. Read this whole file before starting. Section 15 (Working Standards) applies to every change.

---

## 1. Product Summary

An exam preparation platform for Cambridge IGCSE, O Level and A Level students.

- Students practise **original, AI-generated, teacher-approved questions** organised by syllabus topic.
- AI marks written answers, explains mistakes, and tracks weak topics.
- The platform recommends targeted practice and measures improvement over time.

**Core value:** show students where they lose marks, give them the right practice, and prove they are improving. It is not a past-paper archive.

**Launch market:** Pakistan only. International expansion later, depending on growth.

**MVP scope:** one subject, one syllabus. Subject not yet chosen (see Section 14).

---

## 2. Decisions Already Made

| Area | Decision |
|---|---|
| Market | Pakistan first |
| Copyright model | Cambridge papers stored internally for reference only. Students only ever see original content. |
| Hosting | Cloudflare (Workers, D1, R2) |
| Database | Cloudflare D1 |
| Auth | Better Auth: email OTP + Google sign-in. Phone OTP later. |
| Python workloads | GitHub Actions only. Nothing runs on the owner's computer. |
| Builder | Owner builds with Claude Code |
| Launch infra | Free tiers during development and free beta. Workers Paid ($5) once students pay. |

---

## 3. Copyright Rules (hard rules, never break)

1. **Cambridge material is internal only.** Past papers, mark schemes, examiner reports, grade thresholds and specimen papers are never shown, served, downloaded or previewed to any student or parent role.
2. **Only Super Admin and Content Manager roles** can view source documents. Every access is written to the audit log.
3. **Generated questions must be original.** New scenario, new wording, new structure, new diagrams. Changing only numbers or names is not acceptable.
4. **Similarity check is mandatory** before any generated question can be published. Questions above the similarity threshold are blocked.
5. **AI prompts for generation use skills and mark patterns**, not source text to rewrite.
6. **Students may see an index** (year, paper, question number, topic, marks) and a link to an official Cambridge-hosted copy where one exists. Never a copy we host.
7. **Statistics about papers are allowed** (topic frequency, typical marks, command words).
8. **Acquisition agent** downloads only publicly accessible files. No logins, no paywall or CAPTCHA bypass. Respects robots.txt and site terms. Approved source list is set by the owner.
   - **Owner update, 2 Nov 2026:** the owner lifted the "official Cambridge only / no third-party copies" limit and asked for the agent to collect from shared Google Drive collections (third-party copies of Cambridge papers). The agent uses Google's official Drive API with an API key for folders shared as "anyone with the link". Still in force: no paywall or CAPTCHA bypass, robots.txt and AI opt-outs on websites are honoured (revisiontown.com blocks AI agents, so its pages are never crawled; only the Drive folder links are used), and students never see source files (rule 1). The copyright position of third-party copies is the owner's call (open decision 8).

---

## 4. Users and Roles

| Role | Access |
|---|---|
| Super Admin | Everything, including settings, users and billing |
| Content Manager | Syllabus, topics, source documents, generation jobs, question bank |
| Reviewer (teacher) | Review queue: approve, edit, reject questions and AI marking samples |
| Student | Practice, AI feedback, progress, own data only |
| Parent (later) | Linked students' progress, billing |
| Tutor / School (Phase 3) | Assign practice, monitor students |

Every route checks auth and a role allow-list. Every record checks ownership.

---

## 5. Tech Stack

| Layer | Choice |
|---|---|
| Web app | Next.js + TypeScript + Tailwind, PWA, deployed to Cloudflare Workers (OpenNext adapter) |
| Database | Cloudflare D1 |
| File storage | Cloudflare R2 (private buckets, signed access only) |
| Auth | Better Auth (email OTP plugin + Google OAuth) |
| Email | Resend, with SPF and DKIM on our domain |
| Python jobs | GitHub Actions, triggered from the admin panel |
| AI | Claude API: Sonnet 5.5 for generation, extraction and marking. Haiku for student chat and light tasks. |
| Maths display | KaTeX + mhchem |
| Maths input | MathLive |
| Answer verification | SymPy (in GitHub Actions) |
| Diagrams | Matplotlib, JSXGraph, Schemdraw, RDKit, SVG templates. Biology: designer-made labelled library. |
| Payments (Phase 2) | Safepay or PayFast, plus JazzCash and Easypaisa |
| Monitoring | Sentry, PostHog (free tiers) |

**Rule:** never use image generation models for diagrams. Diagrams are produced by code so labels and scales are exact.

---

## 6. Architecture

```
Student / Admin browser
        |
Cloudflare Worker (Next.js app, auth, API, admin panel)
        |                 |                     |
       D1                R2                Claude API
  (all app data)   (PDFs, diagrams,      (marking, chat)
                    student uploads)
        |
  Admin triggers job -> GitHub Actions (Python)
                          - acquisition agent
                          - PDF extraction
                          - question generation (Batch API)
                          - SymPy checks, diagram rendering
                          - similarity check
                          -> writes results to R2 and D1
                          -> job status + alerts back to admin
```

- Workers trigger Actions via `repository_dispatch`. Actions write to D1 via the Cloudflare API.
- All secrets live in Cloudflare and GitHub secret stores.
- Jobs log progress and failures to a `jobs` table and alert. They never fail silently.

---

## 7. Data Model (starting point)

Use real foreign keys and consistent naming so deletion and export pick up every table automatically.

**Auth (Better Auth):** `user`, `session`, `account`, `verification`, plus `user_role`.

**Syllabus:**
- `subject` (name, level)
- `syllabus` (subject_id, code e.g. 0625, valid_from_year, valid_to_year)
- `topic` (syllabus_id, parent_id, code, title, sort_order)
- `learning_objective` (topic_id, text)

**Internal source material (admin only):**
- `source_document` (syllabus_id, session, year, paper, variant, doc_type [qp, ms, er, gt, sp], r2_key, sha256, source_url, acquired_at, status)
- `source_question` (source_document_id, number, part, marks, text, latex, diagram_r2_keys, mark_scheme_text, topic_ids, command_word, extraction_confidence, review_status)

**Original question bank:**
- `question` (syllabus_id, type [mcq, structured], stem, latex, diagram_r2_key, diagram_code, marks, difficulty, skill, command_word, status [draft, pending_review, approved, retired], similarity_score, nearest_source_question_id, generated_by_job_id, reviewed_by, reviewed_at)
- `question_topic` (question_id, topic_id)
- `question_part` (question_id, label, text, marks)
- `mcq_option` (question_id, label, text, is_correct)
- `mark_point` (question_part_id, text, marks, alternatives)
- `question_report` (question_id, user_id, reason, status)

**Student activity:**
- `attempt` (user_id, mode [practice, diagnostic, mock], started_at, submitted_at)
- `answer` (attempt_id, question_id, part_id, response_text, response_latex, upload_r2_key, score, max_score)
- `ai_mark` (answer_id, points_awarded_json, mistake_tags, feedback, confidence, flagged, model, tokens_in, tokens_out)
- `mastery` (user_id, topic_id, score, updated_at)
- `mistake_stat` (user_id, mistake_tag, count, updated_at)

**Platform:**
- `job` (type, status, params, progress, error_ref, started_at, finished_at)
- `ai_usage` (user_id, date, feature, tokens, cost) for caps
- `audit_log` (actor_id, action, entity, entity_id, at)
- `plan`, `subscription`, `payment` (Phase 2)

---

## 8. Content Pipelines

### 8.1 Acquisition agent (GitHub Actions)
1. Input: syllabus codes, year range, sessions.
2. Builds expected file list from Cambridge naming (e.g. `0625_s23_qp_42`).
3. Downloads from the owner-approved source list only, a few seconds between requests.
4. Validates: real PDF, not a duplicate (sha256), matches syllabus and session.
5. Uploads to private R2, records in `source_document`.
6. Produces a gap report of missing files.
7. Triggers extraction.

Manual bulk upload in the admin panel must also work, for gaps.

### 8.2 Extraction
1. Parse metadata from filename.
2. Split PDF into pages.
3. Claude vision returns structured JSON per page: questions, parts, marks, text, LaTeX, diagram descriptions and bounding boxes.
4. Crop diagrams to R2.
5. Match questions to mark scheme entries.
6. Tag topics and command words against the syllabus.
7. Low confidence items go to a review queue.

### 8.3 Question generation
1. Content Manager picks topic, skill, difficulty, count.
2. Batch API generates: question, parts, LaTeX, diagram code, mark points, MCQ distractors.
3. SymPy recomputes every numeric answer.
4. Diagram code renders to SVG in R2.
5. Second independent AI pass solves the question. Mismatch means reject.
6. Similarity check against `source_question`. Above threshold means reject.
7. Survivors go to `pending_review`.

### 8.4 Review
- Reviewer approves, edits or rejects. Only `approved` questions reach students.
- Reviewers also spot-check a sample of AI marking each week.

---

## 9. Student Features (MVP)

1. Sign up / log in (email OTP, Google).
2. Choose subject and exam session date.
3. **Diagnostic test** to set starting mastery per topic.
4. **Topic practice:** MCQ (auto-marked) and structured questions (AI-marked).
5. **Answer input:** text, MathLive for equations, photo upload of handwritten work.
6. **AI feedback:** marks per point, what was missing, mistake type, step-by-step solution.
7. **Flag this marking** and **report this question** buttons.
8. **Progress dashboard:** mastery by topic, accuracy over time, top mistake types.
9. **Recommendations:** "try these 5" from weakest topic or mistake type, unseen questions at or slightly above level. Re-test a few days later.
10. **Past paper index** (optional): year, paper, question, topic, marks, link to official copy only.
11. **AI tutor chat** (Haiku), on-topic only, with daily usage caps.

### Mastery logic (starting point)
- Score 0 to 100 per topic.
- Recent answers and harder questions weigh more.
- Topic exam-frequency (from internal stats) raises recommendation priority.

---

## 10. Admin Features (MVP)

- Subjects, syllabuses, topic tree, learning objectives.
- Source document library (upload, acquisition jobs, gap report, extraction status).
- Generation jobs (create, monitor, cost per job).
- Review queue (questions, extraction issues, flagged markings, student reports).
- Question bank (filter, edit, retire).
- Users and roles.
- AI usage and cost dashboard.
- Audit log viewer.

---

## 11. AI Rules

- Sonnet 5.5 for generation (Batch API, 50% cheaper), extraction and marking. Haiku for chat.
- Prompt caching on mark schemes and system prompts.
- Every AI mark stores confidence. Low confidence is flagged for review.
- Per-user daily caps on AI marking and chat, set in config, enforced inside the database write.
- **Student safety:** users are mostly minors. Assistant stays on subject, refuses off-topic or unsafe content, and guides rather than doing homework wholesale.
- Store model name and token counts on every call for cost tracking.

---

## 12. Security and Compliance

- Follow Section 15.2 on every change.
- Users are mostly under 18: collect minimum data, no public profiles, clear privacy policy.
- Plan parental consent and parent accounts before international launch (GDPR, UK Children's Code, COPPA).
- Account deletion removes every row and R2 file owned by the user.
- Source documents bucket is private and never exposed by URL to non-admin roles.

---

## 13. Build Plan

Build one step at a time. Each step is diagnosed, proposed, approved, built, tested and merged before the next.

**Phase 1: MVP (free beta)**
0. Repo, CI (typecheck, checks, migrations, deploy), Cloudflare setup, docs skeleton (CLAUDE.md, history log, feature list, dev checklist).
1. Auth: email OTP + Google, roles, sessions.
2. Syllabus and topic admin.
3. Source documents: R2 upload, acquisition agent, gap report.
4. Extraction pipeline.
5. Question generation, verification, similarity check.
6. Review queue.
7. Student MCQ practice.
8. Structured answers and AI marking (text, MathLive, photo upload).
9. Mastery, progress dashboard, recommendations.
10. Diagnostic test.
11. AI tutor chat with caps.

**Phase 2: Paid launch**
12. Payments (Pakistan gateways), plans, subscriptions.
13. Timed mock exams.
14. Notifications (email first, WhatsApp later).
15. Switch to Workers Paid.

**Phase 3: Expansion**
- More subjects and levels, parent and tutor accounts, phone OTP, adaptive testing, international payments.

---

## 14. Open Decisions (ask the owner)

1. MVP subject and syllabus code (suggested: an MCQ-heavy science such as Physics or Chemistry).
2. Approved source list for the acquisition agent.
3. Similarity threshold value.
4. Payment gateway choice.
5. Pricing and free plan limits.
6. Brand name and domain.
7. Parent accounts in MVP or Phase 2.
8. IP lawyer review of the copyright approach (pending).

**Known tension with working standards:** mock exams need answer saving during a timed test, which implies auto-save or AJAX. Propose the approach and get approval before building it.

---

## 15. Working Standards (apply to every change)

### 15.1 How work is done
- Identify first, code second: diagnose, offer options with a recommendation, and wait for approval on anything non-trivial.
- Build one step at a time, and merge each step before starting the next.
- Never open a PR unless asked; the owner merges.
- Keep it simple: one page, one form, POST then redirect then GET. No modals, AJAX or auto-save unless truly needed or asked for.
- Scale testing to the size of the change: a small tweak needs a typecheck and a diff read, real logic needs a full local-server test.
- Report honestly: show failures, say what was skipped, never hide a broken test.
- Raise any concern you notice, even outside the current task.

### 15.2 Security, on every change
- Every route has an auth check and a role allow-list, and ownership is checked on every record.
- Never trust an id from the browser. Check that every child id belongs to the same parent.
- Validate all input on the server (type, length, format, allowlist). Browser limits are only a convenience.
- Escape everything on output: HTML, attributes, emails and values written into scripts.
- SQL always uses bound parameters, never built strings.
- Redirects only go to same-site paths, never to a user-supplied URL.
- Uploads use an allowlist, a safe filename, a content type taken from the validated extension, nosniff, and are downloaded as attachments.
- Tokens are random, single-purpose and expiring, and codes are attempt-limited. Secrets are compared in constant time.
- Trust nothing the browser can edit (hidden fields, cookies) unless the server signed it.
- Rate-limit every write endpoint, more tightly for email, uploads and secrets.
- Never reveal whether an account or email exists, by wording or by timing.
- Webhooks: verify the signature and timestamp, block replays, and never grant anything from unsigned input.
- Errors show the user a reference id only. Details go to logs and alerts.
- Secrets live only in the platform's secret store, never in code, logs, URLs or a fallback value.
- A new dependency needs a reason, a pinned version, and integrity hashes for browser scripts.
- Plan deletion up front: when an account is deleted, every database row and stored file it owns goes too.
- Test like an attacker: wrong user, wrong role, replayed or oversized input. Add regression tests.
- Any limit that can be raced (a burst of parallel requests) is checked inside the database write itself.
- Cookies are always HttpOnly, Secure and SameSite, with no Domain.

### 15.3 Code structure
- One shared helper per job (validation, money format, dates, limits). Never copy logic per page.
- Look for an existing helper before writing a new one.
- No hardcoded settings, limits or brand names. Read them from config or the database.
- Shared queries live in one place, never hand-copied.
- Each tab or view gets its own handler, with no monolithic handlers.
- New features are built so deletion and data export pick them up automatically (real foreign keys, consistent column naming).

### 15.4 Front end
- Mobile first, tested at the real target phone size.
- All styling in one central stylesheet with named classes. No inline styles except genuinely dynamic values.
- Reuse an existing class before adding a new one.
- No new inline event handlers. Attach events from the script, and keep a count that is never allowed to grow.
- Every popup, menu or drawer closes on Escape and returns focus to what opened it.
- Anything clickable is a real button or link, and keyboard-usable.
- Destructive actions use an inline Yes / Never mind confirm, never the browser's confirm().
- Any outside script or service is added to the security policy explicitly.

### 15.5 Database and deploys
- Migrations are additive only. Never drop or rename in the same release.
- CI runs typecheck, then the automated checks, then migrations, then deploy, so a broken change never ships.
- Loops over many rows run in batches with a cap and an alert, never unbounded.
- Background jobs log problems and alert, so they never fail silently.

### 15.6 Documentation, in the same commit as the code
- A current-state reference file (CLAUDE.md), kept short.
- A history log of what changed, why, and how it was tested.
- A plain feature list for non-developers.
- User guides updated whenever what users see changes.
- A dev checklist that is updated whenever the process changes.
- Each new test suite documented in the tests README.

---

## 16. Budget Guardrails

| Item | Expected cost |
|---|---|
| Dev and free beta infra | $0 |
| Paid launch infra | ~$5/month (Workers Paid) |
| Initial extraction, one subject (~4,000 pages) | ~$30 one-time |
| Initial generation (~2,000 questions) | ~$100 one-time |
| AI per active paid student | ~$1/month |

Show cost per job in the admin panel. Alert if AI spend exceeds a configured daily limit.
