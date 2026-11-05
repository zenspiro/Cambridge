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

## Still open

- Brand name and domain (brief, section 14).
- Then a phased build plan replacing brief section 13 (student and parent first).
