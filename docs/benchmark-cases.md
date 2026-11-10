# Benchmark cases

Real papers where a reading or a fix went wrong, kept for the reading benchmark (review, 10 Nov 2026: "a wrong
reading on one paper is first added to the benchmark as a case; only a class seen on 3 or more benchmark papers earns
a code rule"). Each case: the paper, what went wrong, what was done. The papers' text stays in R2, never in the repo.

## 1. Nov 2025 Paper 42 (0625_w25_qp_42), question 9(b): a table in the opening text

- The reading joined 9(b)'s opening text and Table 9.1 (as text lines with "|") onto 9(b)(i).
- "Give it its own part" split it with the paper's own words for the opening text, which for a table come out as one
  jumbled line ("radioactive type of radiation half-life source emitted P alpha ..."), so the table was lost. The
  table flag stayed on 9(b)(i).
- Done (10 Nov 2026): a safety guard, not a reading rule: a part holding a table is never split by code
  (`holdsTable`; `applyFix` answers `has_table`; `autoFixLeads` skips it; the button is off with a note). Read it
  again instead.
- Then (10 Nov 2026): after Undo, Read it again on 9(b)(i) asked for that part only, so 9(b)'s opening text and
  table were in no part. Fixed: a first part is read again with the opening text above it (`withLeadIns`).
- For the benchmark: the expected reading has 9(b) as the opening text with Table 9.1 as a table, and 9(b)(i)
  "Define half-life of a radioactive isotope."
