# Product plan: decisions and path forward

The owner's commercial and product decisions, kept here so every session can read them. Newest decisions win over
`docs/BRIEF.md` where they differ. Planning only: nothing below is built yet unless marked live. Owner is not from the
education industry, so recommendations come from the builder; the owner decides.

## Order of work (owner, 5 Nov 2026)

1. Student and parent first.
2. Teacher portal second, but the database must be ready for teachers, seats and classrooms from day one, so nothing
   is rebuilt later.
3. Topics agreed one at a time: 1 AI engine, 2 accounts, 3 pricing, 4 payments, 5 student interface (three switchable
   themes), 6 child safety and parental consent (agreed).

## 1. AI engine (the USP; quality decides whether the product lives)

- **Subject brain:** a separate knowledge store per subject, built from the library: syllabus topics and learning goals,
  marking rules from mark schemes (what earns, what is accepted or ignored), common mistakes per topic from examiner
  reports, topic frequency and paper blueprints (marks, time, topic mix) from past papers, grade thresholds. Every
  correction becomes a rule, so each subject improves over time.
- **Human input (option A, owner 5 Nov 2026):** the brain is built automatically; human reviewers come later. **At the
  start there is no teacher budget: the AI checks itself.**
- **Self-checking without teachers:**
  - A second AI from a different provider checks every question and mark independently. Disagreement: the question is
    thrown away, or the mark shows as "provisional".
  - Code recalculates every number.
  - Every mark must point to a stored mark point. No source, no mark.
  - Free test bank: the mark scheme's model answers must score full marks, and the wrong answers quoted in examiner
    reports must lose the right marks. Every AI change must pass before going live.
  - Start with fully checkable questions (multiple choice, calculations); long written answers later.
  - Students can flag a marking, which triggers a stricter second check.
  - Later: teachers get free seats in exchange for approving questions.
- **Diagrams:**
  - Never AI image generators, which get labels and numbers wrong.
  - The AI (Claude Opus class) writes drawing code (SVG): graphs plotted from the answer's own numbers, circuits, ray
    diagrams, geometry, chemical structures, flowcharts and logic gates, lab equipment, and elaborate freehand drawings
    (biology). Each drawing is made once and stored.
  - A second AI checks the rendered picture against the question; on a mismatch it is redrawn or dropped.
  - **Animated explanations** in feedback (waves, current, reactions) set it apart.
  - Real photos (microscope slides, specimens) wait for our own image library.
  - Past paper diagrams are only read by the AI, never shown (copyright rule).
- **Mock exams:** built from approved original questions to the real paper's blueprint; end with a predicted grade
  from grade thresholds and "where you lost marks".
- **Model:** Workers AI (Llama) stays for file sorting only. Marking and generation use a top model (brief: Claude), at
  about $1 per paying student a month.

## 2. Accounts and portals

- **One sign-in** (email code or Google). A person can hold several roles (a teacher can also be a parent).
- **Student:** own account; can be linked to a family and to classrooms.
- **Parent and family:** a parent creates a family and adds children, either by invite code or by creating the
  child's account. A second parent or guardian can join (view only, or view and pay). Parents see progress per
  subject, weak topics, mock results, predicted grade, time spent, and a weekly summary (email, WhatsApp later). They
  do not see the AI chat word for word.
- **Teacher (second priority):**
  - Buys seats on a separate subscription.
  - A classroom is one subject plus one exam session (for example "Physics 0625, June 2027"). Students join with a
    class code; each takes a seat, and removing a student frees it.
  - A dashboard across all classrooms. A teacher sees only work in their own classroom's subject.
  - Solo tutors and academies first; schools with shared seat pools later.
- **Seat model, option A+ (owner 5 Nov 2026):**
  - A seat covers only work the teacher assigns (practice sets, homework, mocks), with AI marking and feedback on it.
  - Practising alone needs the student's own plan, and then the teacher still sees only assigned work.
  - Fair-use limit of AI-marked answers per seat per month (for example 300).
  - No AI tutor chat on a seat, only "explain this" on assigned questions.
- **Academy commission (confirmed):** students in a classroom get a discount (for example 20%) on their own plan, and
  the academy earns 15 to 20% of what its students pay.

## 3. Pricing (structure agreed; owner enters real prices)

- **Price per country, not exchange rate:** each currency has its own price list, set in the admin panel, never
  auto-converted. Start with PKR, AED, SAR, USD, GBP. The currency follows the card's country, not the visitor's
  location (stops VPN price shopping).
- **Subject tiers:** Single (1 subject), Core (any 3), All subjects. Upgrade anytime, paying only the difference.
- **Durations:** monthly (renews, cancel anytime) and an exam session pass (one payment until the chosen session ends,
  worth about 30% less than monthly). The session pass is expected to sell most in Pakistan.
- **Free tier:** a diagnostic test and a few AI-marked questions a week, so students feel the AI quality.
- **Family:** one bill, 25% off each extra child.
- **Teachers:** price per seat, monthly or per session, a minimum of 5 seats, cheaper at 30+ and 100+.
- **Mock prices (placeholders only):**

| | PKR | AED | SAR | USD | GBP |
|---|---|---|---|---|---|
| Single, monthly | 1,500 | 39 | 39 | 9.99 | 7.99 |
| All subjects, monthly | 4,000 | 99 | 99 | 24.99 | 19.99 |

## 4. Payments (option A, owner 5 Nov 2026)

- The business is registered in Pakistan, so Stripe is out.
- **Safepay** for PKR (cards and wallets, subscription tools, PKR payout). JazzCash and Easypaisa automatic renewal is
  unclear, another reason the session pass leads.
- **Paddle** for AED, SAR, USD, GBP. It is the merchant of record (it handles VAT and invoices). A Paddle account is
  already connected to the dev sessions. To confirm: whether Paddle charges in AED and SAR, or only displays them.
  Apply early, since Paddle reviews each business.
- Our own database holds the price lists. Gateways only take payment and tell us (webhooks) when a payment succeeds,
  renews or fails. We never store card numbers.
- Owner to ask an accountant about PSEB registration (lower tax on foreign software income).

## 5. Student interface (ages 14 to 16)

- Phone first (Android, slow data), installable, works at 375 px, dark mode from day one.
- Looks like the apps teens use, not a school portal, and not childish.
- **Home:** exam countdown, predicted grade per subject, a 15 minute plan picked by the AI, streak and weekly goal.
- **Practice:** one question per screen, instant feedback, where the mark was lost, an "I'm stuck" hint that guides.
- **Motivation:** streaks, points and badges tied to real progress. Leaderboards only among friends or the class,
  with nicknames, and no public profiles.
- **Parent screens:** calm and report-like, no game elements.
- **Style mockups (5 Nov 2026):** A "bold and focused" (recommended), B "playful game", C "clean study", home and
  practice screens each, on a private design canvas: https://claude.ai/artifact/CgbzTnsKctmmLTUvC7Mkuz.
- **Themes (owner 5 Nov 2026): keep all three as themes the student can switch.**
  - One layout, built once; a theme changes look only: colours, fonts, corner shapes, shadows, illustrations.
  - The wording is the same in every theme (owner chose look only), so B's "quests" and "LET'S GO!" become the
    shared wording or go. Its mascot may stay as a picture without its own lines.
  - Default theme A; picked at sign-up or in settings, switchable anytime.
  - Questions, AI feedback, grades, streaks and XP are the same in all three.
  - Parent screens stay calm and report-like in every theme.
  - Built from shared style settings (tokens), so another theme later is cheap.
  - Every student screen is tested in all three themes at 375 px.

## 6. Child safety and parental consent (owner 5 Nov 2026)

- Not legal advice: a lawyer checks this before launch, with the copyright question.
- **Parent approval, option B, configurable in admin:** a parent approves every student under 18 (one-tap link at
  sign-up, WhatsApp later). The age limit is a setting per country in the admin panel, not code.
- **Sign-up collects:** first name, last name, email, birth year, country. No nickname, no school, no phone, no face
  photos.
- **Exam session is not asked at sign-up.** A session pass picks its session at checkout. For the exam countdown, the
  student sets the exam session per subject in their profile (asked once, gently, after the first login; changeable).
  Monthly plans do not need it.
- **Leaderboards** (friends or class only) show first name and last initial, since there are no nicknames.
- **Safe by design:** no messaging between students at the start; no public profiles; no ads or tracking on student
  pages; student data never sold.
- **AI safety:** stays on subject; on worrying messages (self-harm, abuse) it stops, shows a local helpline and flags
  the conversation. Photos of handwritten work are deleted automatically after marking (for example 30 days).
- **Parents** can see, export or delete their child's account and data.
- **For the lawyer:** privacy policy and terms, Saudi rules on storing data abroad, the copyright approach.

## 7. Database and scale (answered 5 Nov 2026)

- D1 handles 1,000 students at peak (roughly 30 to 50 saves a second) on Workers Paid ($5 a month: 10 GB per
  database, no daily read cap). It is needed at launch anyway.
- The student tables do not exist yet. Design rules for them:
  - Files and long AI feedback live in R2, not the database.
  - One small row per answer. Old attempts are summarised into per-topic scores and then archived.
  - A school can get its own database later.
  - Vectors ("similar questions", subject brain search) live in Cloudflare Vectorize.

## 8. Phased build plan (draft 5 Nov 2026, awaiting owner approval)

Replaces brief section 13 once approved. Each step is planned, approved ("go"), built, tested and merged before the
next. Start with one subject (recommended: IGCSE Physics 0625, the fullest library) and add subjects only when each
passes its quality bar. Admin work and the library already built (Phase 0) stay as they are.

### Phase 1: Foundations (student and parent accounts)
1. **Theme system (built 5 Nov 2026).** Style tokens for themes A, B and C in the central stylesheet (`data-theme` on the page), student
   and parent page frames, shared component classes. Look only: same markup and wording in every theme.
   **Brand settings in admin (owner 5 Nov 2026):** platform name, footer statement, logo, square logo and favicon
   (and every similar brand item) are set in the admin panel, never in code.
2. **Sign-in (built 5 Nov 2026).** Email code and Google for students and parents (admin sign-in stays as it is). Roles held per
   person, so one person can have several.
3. **Profiles and parent approval (built 5 Nov 2026).** First and last name, email, birth year, country; parent approval for under 18
   (age limit per country, an admin setting); exam session per subject in the profile; see, export and delete.
4. **Families (built 5 Nov 2026).** One family per parent; a child belongs to one family; no second
   guardian (owner). A parent adds an existing child with a family code the child types on Me (7 days), and a child
   they approved by email links by itself when the parent signs in with that email. Children need their own email
   (parent-made child accounts need one too and count as approved). Parent home: children, their details, exam
   sessions and status, approve from home, download a child's data, remove from the family, delete the child's
   account. A child can leave the family only once over the age limit. Built so a family plan can attach later.
5. **Access grants, teacher-ready.** Every right to use the app comes from one grant table (free tier, own plan,
   family plan, later a teacher seat), so seats plug in later without rebuilding.

You see at the end: students and parents can sign up, approve, link, and land on empty home screens in any theme.

### Phase 2: The subject brain (admin side; must exist before students practise)
1. **Topic tree.** Topics and learning goals per syllabus, drafted by AI from the syllabus PDF, shown in admin.
   **Built 5 Nov 2026.** Owner decisions: runs on GitHub Actions; second provider Google Gemini (cheaper for this job);
   no human review (owner is not a subject expert): code checks every word against the PDF's text and the numbering,
   Gemini copies separately, the text settles differences, Claude gets one more try; Ready only when all checks pass
   and the two agree on 97%+. Later steps use Ready trees only.
2. **Reading the papers.** Past papers, mark schemes and examiner reports turned into structured questions, mark
   points, common mistakes, topic frequency and paper blueprints (runs on GitHub Actions).
   **Review screen (owner, 6 Nov 2026; mockup agreed):** opened from any stored paper. Left: the PDF as stored. Right:
   the same page rebuilt from our database to look like the paper (numbering, wording, [marks], figures, answer
   lines); one page bar turns both; toggle question paper / mark scheme. Flags boxed with a one-line reason: red
   wording differs, amber numbers or marks differ, blue our own drawing of a figure (compare by eye); a flag count with
   "Next flag"; "Show flags" on or off. Not for the topic tree. Fixing a flag (all four agreed): use the PDF's version
   (code copies the PDF text, no AI), read it again (that question or the whole paper, re-checked), edit it yourself
   (checked against the PDF), or "It's fine" (false alarm, remembered); figures: Redraw or Looks right. Every fix is
   audited with Undo and becomes a rule for the subject. A paper is ready when its flags are cleared, and the admin
   may mark it ready anyway when the remaining flags can be ignored (recorded as an override).
   **Step 2 decisions (owner, 6 Nov 2026):** Physics 0625 first, other subjects once it is proven. "Read this paper"
   (runs at once) first, then "Read all" for a whole subject and later every subject (Anthropic's batch service, half
   price, results within hours). Every run skips what is already confirmed and reads only missing or unconfirmed
   pieces. Every figure is drawn automatically (our own drawing, for comparison on the review screen). Build order:
   2a sidebar, full width, Parent approval page, review screen with the PDF side; 2b question papers and mark schemes
   with flags, fixes and override; 2c examiner reports, grade thresholds, blueprints, topic frequency.
   **2b built 7 Nov 2026** ("Read this paper", the rebuilt paper with flags and fixes, override, live run progress).
   Still to do in step 2: "Read all" for a subject (batch, half price), then 2c.
3. **Question making with self-checks.** Original questions; a second AI from another provider solves each one, code
   recalculates numbers, similarity check against past papers; diagrams drawn as code and checked by a second AI.
   Failures are thrown away.
4. **Test bank and quality score.** Model answers must score full marks, examiner-report mistakes must lose marks; a
   quality score per subject in admin; every AI change must pass before going live.

You see at the end: an approved Physics question bank and its quality score.

**Admin UI/UX overhaul (owner, 7 Nov 2026, on the back burner):** a design pass over the whole admin (shared
buttons with sizes and a busy state, aligned form fields, cards, status pills, progress steps, toast messages for
feedback, in the style of shadcn/ui but built on our own classes so the strict CSP holds). Not now: 2b comes first.
It must be done before any student or parent page is built (Phase 3).

### Phase 3: Student practice (free beta)
1. **Home and diagnostic.** Diagnostic test, home screen (countdown, predicted grade, today's plan), multiple choice
   practice in place with no reloads.
2. **Written answers and AI marking.** Typed answers with a maths keyboard, marks per point, where the mark was lost,
   "I'm stuck" hints, flag a marking.
3. **Progress.** Mastery per topic, predicted grade, recommendations, streaks, XP, class or friend leaderboards
   later with the teacher portal.
4. **Parent dashboard.** Children's progress, weak topics, time spent, weekly email summary.

You see at the end: a free beta with real students on Physics.

### Phase 4: Paid launch
1. **Price lists and plans.** Per currency in admin; Single, Core, All; monthly and session pass; free tier limits;
   family discount.
2. **Payments.** Safepay (PKR) and Paddle (others) with signed webhooks that switch access grants on and off.
3. **Timed mock exams.** Built to the paper blueprint, answers saved in the background, predicted grade at the end.
4. **Go-live.** Workers Paid, AI spend alerts, privacy policy and terms after the lawyer's review.

You see at the end: students and parents can pay and sit mock exams.

### Phase 5: Teacher portal
Classrooms (subject plus exam session), seats on a teacher subscription, assigned work only (A+), fair-use limit per
seat, dashboards across classrooms, class discount and academy commission.

### Phase 6: Growth
More subjects (one at a time, quality bar first), animated explanations, photos of handwritten work, AI tutor chat,
WhatsApp summaries, "Find on Cambridge", O Level and A Level.

### Needed from the owner along the way
- Phase 1: approve Better Auth (sign-in library) and an email sender for sign-in codes.
- Phase 2: a Claude API key and a Gemini API key, as GitHub Actions secrets `CLAUDE_API_KEY` and `GEMINI_API_KEY` (set by the owner, never shared in chat; `docs/guides/topic-tree-setup.md`).
- Phase 4: brand name and domain, Safepay and Paddle accounts, real prices, the lawyer's review.

### Coding standards that apply to all of it (brief section 15, CLAUDE.md)
- One central stylesheet with named classes and theme tokens; no inline styles (`check:inline` counts never grow).
- No page reloads unless necessary, never browser popups. This overrides the brief's older "no AJAX" line: practice,
  marking and mock exams save in the background through small route handlers.
- One shared helper per job; look for an existing one first. Shared queries in one place.
- Each view and each action has its own handler; no monolithic handlers.
- No hardcoded settings, limits, prices, age limits, model names or brand names: config, Worker vars or the database.
- Security on every route: auth, role allow-list, ownership of every record, server-side validation, bound SQL,
  same-origin POSTs, rate limits inside the database write, signed webhooks, secrets only in the secret store.
- Real foreign keys with cascade toward the owner, so deletion and export find everything.
- Student and parent pages tested at 375 px in all three themes; admin at 1400 px.
- Docs (CLAUDE.md, HISTORY.md, FEATURES.md, DEV-CHECKLIST.md, tests README, guides) in the same commit as the code.

## Still open

- Brand name and domain (brief, section 14), needed by Phase 4.
- Owner approval of the phased build plan (section 8).
