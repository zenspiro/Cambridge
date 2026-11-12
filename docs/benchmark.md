# Reading benchmark

Owner decision, 11 Nov 2026 (option A). Until now every reading fix was found on one paper and checked on that paper.
The benchmark is a fixed set of real papers with answer keys, so every change to the reading rules is measured on all
of them: it ships only when the score goes up and nothing that was right goes wrong. Cases that led to a rule are in
`docs/benchmark-cases.md`; a class of mistake earns a code rule only when it shows on 3 or more benchmark papers.

## The set (`BENCHMARK` in `src/lib/brain/benchmark.ts`)

54 documents: 48 question papers and 6 mark schemes, variant 2 (what Pakistan sits), 2023 to 2026.

| Subject | Question papers | Mark scheme |
|---|---|---|
| Biology 0610 | P1, P2, P3, 3 × P4, P5, 2 × P6 | Mar 2025 P42 |
| Chemistry 0620 | P1, P2, P3, 3 × P4, P5, 2 × P6 | Jun 2025 P42 |
| Physics 0625 | P1, P2, 2 × P3, 3 × P4, P5, P6 (5 already read, both known cases) | Mar 2025 P42 |
| Maths 0580 | P1, 2 × P2, 2 × P3, 4 × P4 | Nov 2024 P42 |
| Computer Science 0478 | 4 × P1, 5 × P2 | Nov 2025 P22 |
| Geography 0460 | Jun 2025 P12, P22, P42 (the smallest files; inserts left out) | Jun 2025 P22 |

How it was picked: every stored variant 2 question paper from 2023 on (245, plus the 5 Geography ones uploaded) was
measured with the reading script's own steps: figures and tables named, fractions, superscripts and subscripts, code
lines, opening text before parts, pages that go to the AI as pictures. For each subject and paper, the richest papers
were taken first, spread over sessions and years (every year and Mar, Jun and Nov in each subject).

Locked set: 16 papers, about a third per subject, chosen at random (never a paper already read). Rules are never tuned
on them: the score script shows only their totals unless asked (`--show-locked`). The other 38 are the tuning set.

## Answer keys (`benchmark/keys/<file>.json`)

Structure only, never a paper's wording (a unit test keeps every string short):

- `parts`: every part that earns marks, with its printed [marks] (multiple choice: none, one mark each).
- `leads`: questions and parts with opening text before their first sub-part; a reading gives it its own item.
- `figures`, `tables`: the part holding each labelled figure and table: the first part whose words name it, or the
  next one (`also`, for a figure described between two parts).
- `notation`: printed notation a part must keep, in our markup. Only forms the reader gets right every time: units
  (cm^{3}), standard form (10^{−2}), formulas and ions (Fe_{3}O_{4}, Cr^{3+}), nuclides (^{90}_{38}Sr), simple powers
  (3x^{2}) and plain fractions. Left out: π, ×, vectors and fractional powers, which the text layer garbles; labels
  printed only on a diagram; units after "/" (axis headings).
- `total`, `mcq`, `note`, `unsure`, `status`.

Drafted by `scripts/benchmark/keys.ts` from the PDFs (the same outline and notation steps as the reading script; the
outline now adds up each part's printed marks). Checked: on every question paper the parts' marks add up to the
cover's total and the questions follow on from 1; multiple choice has 40 questions. The one exception is Geography
Paper 1, where candidates answer three of six questions (no total). Mark scheme keys copy their question paper's parts
and marks. Every remaining doubt was settled against the page image, which found four outline bugs, now fixed in
`pdfOutline` and `notate`: marks inside the footer band, marks joined to answer dots, a trace table's "[1] [2]" heading,
a table's row number read as a question, and an invisible comma over the margin that hid a question number
(`CHECKS_VERSION` 6). A key marked `checked` is kept when the drafter runs again (unless `--force`).

## Scoring (`scoreReading`, `scripts/benchmark/score.ts`)

Each fact in a key is one check: the part is there, its marks, its opening text has an item of its own, each figure
and table on the right part, each notation kept (in the wording, options or tables), four options per multiple choice
question. A mark scheme part's marks are its rows added up or its largest row (alternative routes such as C1 can still
read as wrong; known limit). Every part the reading has that the key does not is a failed check. A paper is "fully
right" when every check passes.

```bash
NODE_USE_ENV_PROXY=1 CF_ACCOUNT_ID=<account> CF_D1_ID=<database> node scripts/benchmark/score.ts
```

Read only: one D1 query for the papers' ids, then each reading from R2 `FILES`. It scores the AI's own copy
(`papers/<doc>/ai.json`, owner, 12 Nov 2026): kept from every whole reading of a paper nobody has fixed by hand, and
refreshed by "Read them again for the score" on the Read all card, which reads afresh into that copy only. A paper with
no copy is scored on its stored reading only when it has no hand fixes; otherwise it is named and left out. So
reviewing and correcting benchmark papers is safe. Prints each tuning paper's score and
what is wrong, totals per subject, tuning and locked totals, and the comparison with `benchmark/baseline.json`: exit
code 1 when a check that passed in the baseline fails now. `--save-baseline` keeps the run as the new baseline (refused
while anything regressed). `--dir <folder>` scores readings saved as files instead.

## Reading the set

Each subject's Read all card has "Benchmark papers": the subject's set not read yet, with the rough cost against the
cap, and "Read the N benchmark papers" (route `/admin/library/[code]/read-benchmark`, `planBenchmark`, one batch run
like Read all, with the Reading AI). Estimate for the 48 not read yet: about $0.30 to $0.75 with Haiku as the Reading
AI (from the papers' picture and text pages, and from past runs), about $6 with Sonnet; Gemini is free.

First scores (11 Nov 2026, the 6 Physics documents read before): tuning set 97.6% of 531 checks, Nov 2025 P42 fully
right. What is wrong: tables not found on readings made before tables were read (Mar 2025 P42, P52, P62), subscripts
lost in multiple choice (R₄, V₂, A₁ in Mar 2025 P22), and the mark scheme's alternative-route part above.

Baseline (12 Nov 2026, all six subjects, Haiku as the Reading AI, Gemini where it could help): tuning set 36 of 38
read, 94.1% of 3,286 checks, 9 fully right; locked set 15 of 16, 91.6% of 1,487 checks, 5 fully right. Not scored
until read again for the score: 0625 Mar 2023 P12, Mar 2025 P42, Nov 2025 P42 (fixed by hand before the AI copy). By
subject: 0610 94.4%, 0620 95.3%, 0625 96.7%, 0580 91.8%, 0478 92.3%, 0460 96.0%. What is wrong, largest first: whole
parts left out (0478 Nov 2023 P22 at 67%, 0580 P42s, 0610 Jun 2024 P42, 0620 Jun 2025 P42; the review screen flags
each as missing), multiple choice options not taken (0610 Mar 2024 P22, 0620 Jun 2026 P22), superscripts and
subscripts lost (ion charges in 0620 P6, R₄ and V₂ in 0625 P22, cm² and cm³ in 0580), tables in 0625 P5 and P6, lead-ins
joined, a few marks.

## The rule for changes

1. Score before the change (`score.ts`, baseline saved).
2. Make the change; read the tuning papers again for the score where it touches reading ("Read them again for the score").
3. Score again: no regressions on the tuning set, and the tuning total up. Then save the baseline.
4. The locked total is looked at only to confirm, never to choose between versions of a change.
