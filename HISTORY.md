# History

Newest first. What changed, why, and how it was tested.

## 2026-11-04: Folder upload survives server hiccups

**What:** each file whose upload gets something other than the server's own answer (a Cloudflare error page while the Worker starts, a 5xx, a dropped connection) is tried again by itself after 2, 5 and 10 seconds. Real refusals (wrong year, already stored, not a PDF) are not retried. A file that still fails says what happened ("the server did not answer properly (error 503, tried 4 times)"), and the finish summary has "Try the N failed files again", so nothing needs the folder picked again. The upload route now always answers in JSON.

**Why:** owner's report: a run of 2020 and 2021 Physics files all came back "could not be stored", the words the page used when the reply was not the server's own answer.

**Tested:** 124 unit tests; 207 browser checks (new: every file's first try gets a fake Cloudflare error page and is retried by itself; one file keeps failing until "Try again", then all seven are stored).

## 2026-11-04: Pakistan series codes (1524) sit with their subject

**What:** Cambridge set IGCSE Physics under code 1524 for the Pakistan-only 2021 series. A new table links such codes to the library syllabus (1524 to Physics 0625, seeded). Files keep their real names (`1524_s21_qp_12.pdf`; "1524_j21_*" in collections is read as June 2021), are stored with Physics, and show in June 2021 as "Pakistan series (1524)": its own row on the subject map and its own section on the session page, with the same papers, and variant 2 essential like the rest. The folder upload also learns new codes by itself: a first page with a code the library does not have next to a library subject's name ("CHEMISTRY 1525/22, May/June 2021") links that code to the subject, reads those files again and says so on the page. The agent treats linked codes as the run's subject.

**Why:** owner's report: five 1524 Pakistan-only files went to Needs your eye; Pakistani students need them.

**Tested:** 124 unit tests (new: the owner's five files uploaded under their own names, storing and the checklist series, the map row, learning a code from a cover and refusing bad ones); 206 browser checks (new: a cover teaches the page a new code and the file is stored under it).

## 2026-11-04: The checklist no longer decides what may come in

**What:** (1) any real Cambridge file of a library subject in the library (or run) years is accepted, whether or not the checklist asks for it; the checklist only says what is missing. The AI's answers are kept on that basis (before, a name the checklist did not list went to Needs your eye). A real file from another year is "not needed" with its name and never rejected for good, so a later run for that year takes it. (2) Any other two-letter Cambridge code (source files "sf", or one nobody has seen) is stored as it is and described in words ("Source files", or "Cambridge file (xx)"); a new code needs no code change, and the first page cannot turn it into another type. (3) Needs your eye: the AI's guess is already chosen, so you only check it. (4) "Download report" on the folder page saves a spreadsheet of every file and what happened to it, to send in one go instead of one case at a time.

**Why:** owner: every run led to another tweak (pre-release, specimen pre-release, codes); "less manual work, more AI power".

**Tested:** 120 unit tests (changed: AI names outside the checklist kept, other codes stored as they are); 205 browser checks (new: the report download; a source files PDF uploaded under its own name).

## 2026-11-04: Specimen pre-release material

**What:** specimen pre-release material is a library file, `0478_y20_pm_2.pdf`: its Cambridge site name ("2020-specimen-paper-2-pre-release-material"), its folder words and its first page ("SPECIMEN PRE-RELEASE MATERIAL") all give that name. The checklist does not ask for 2020 specimens, so it shows under "Other stored files".

**Why:** owner report: Cambridge's 0478 2020 specimen pre-release material went to Needs your eye; the reader had every part, but the name was not allowed.

**Tested:** 120 unit tests (new: the owner's file, by its cover, site name and folder); 204 browser checks.

## 2026-11-04: Pre-release material, transcripts, teachers' notes; unknown codes; picker on its own line

**What:** (1) three Cambridge file types the library did not know: pm pre-release material (0478 Paper 2 up to 2022, asked for with the paper), qr listening transcript and tn teachers' notes for the speaking test (French 0520, extras). The file names, the folder words ("Pre-release Material 22"), Cambridge's site names, the front page reader (the "PRE-RELEASE MATERIAL", "TRANSCRIPT" and "TEACHERS' NOTES" headings win) and the AI all know them; the library map shows them. (2) A file named like a Cambridge file with a code the library does not keep (sf source files, or any unknown code) keeps that type: it is "Not needed" with the type named, and neither the first page nor the AI may turn it into another type. (3) 0478 papers for 2020 to 2022 renamed from their covers: Paper 1 Theory, Paper 2 Problem-solving and Programming. The front page reader now reads the paper title, and the folder upload lists any paper whose cover title differs from the library's name. (4) The "Which file is it?" picker sits on its own line, full width, each choice showing the full place in the library ("IGCSE Computer Science (0478) / 2020 / November / 0478_w20_qp_21.pdf"), and says where the picked file goes. (5) Migration 0014 rebuilds `source_document` once more (second owner-approved exception): the type check now accepts any two lowercase letters, so later types need no rebuild.

**Why:** owner report: "0478_w20_pm_21.pdf" (pre-release material) was read as a second copy of the Paper 2 question paper and sent to Needs your eye; the picker was cut off; owner asked for a lookup of other missing codes first.

**Tested:** 119 unit tests (new: the owner's pm and qp pair both uploaded, new names, unknown codes, cover headings and titles, checklist and map, title checks); 204 browser checks (new: an unknown code is not needed, the picker shows the full place on its own line).

## 2026-11-04: Folder upload repeats, clearer rows, readable text

**What:** when two files in a folder come out as the same Cambridge name, the one with the best evidence is uploaded (its own Cambridge name beats folder names, which beat the first page, which beats the AI; then the first one met). An identical copy is listed as a repeat with "Same file as ..., which is uploaded instead"; a different file read as the same name goes to Needs your eye instead of being dropped. Rows now describe files with their paper names for every subject ("Paper 2 Algorithms, Programming and Logic"), say "Will be stored as ..." only when the name changes, and give one plain line on how the file was worked out. All small text in the admin is one size larger (12 px is now 14 px, 14 px is now 16 px); the top bar stays on one line.

**Why:** owner: a 0478 November 2020 question paper showed as a repeat without saying of what; "all text needs to be cleanly readable".

**Tested:** 111 unit tests (new: copies, better evidence wins, a different file is never dropped quietly); 200 browser checks (new: the repeat says which file is kept, paper names in rows).

## 2026-11-04: Folder upload fixes, AI meter, wider admin pages

**What:** (1) files from years outside the library are left out by their names alone (a session code like "w02" or "j21" in the file name, or a year in the folder names, or the year on the first page), never read and never sent to the AI; (2) when the AI recognises a Cambridge file the library does not keep, the page says so plainly instead of "not sure"; (3) the front page reader works in Chrome on PDFs with a line break before "endstream" (it had dropped the end of the page text there; the owner's 1524 June 2021 paper showed it); (4) an AI meter at the top of every admin page: questions today and about how much of Cloudflare's free 10,000 daily units they used (an estimate from tokens; Cloudflare's dashboard is exact); (5) admin pages use 80% of the screen; (6) the folder upload ends with a clear summary (stored, not stored with reasons, already in the library, left out) and a link to the subject.

**Why:** owner report: 2002 files were read and sent to the AI with confusing answers, two 2021 files said "no text" though they have text, no feedback when an upload finished; owner asked for the AI meter and wider pages.

**Tested:** 110 unit tests (new: a Chrome-like strict reader on PDFs built like the owner's file, which fails on the old reader; years from names; old files never read or sent to the AI; the meter); 199 browser checks (new: a 2002 file left out by its name, the meter on the page, the finish summary).

## 2026-11-04: Upload a folder

**What:** a new page, Library > Upload > "Upload a folder". Pick the unzipped folder from a Google Drive download; the browser keeps the folder names and works out every PDF the way the agent does: file and folder names, then the first page of every file (the front page reader, run on your computer), then the AI for what is left. A preview shows what will be uploaded, what is already in the library, files renamed by their first page, the same file twice, files outside the library years, and what needs your eye (choose which file it is, or leave it out). Upload then sends one file at a time with a progress bar and a Stop button; picking the folder again skips what is stored. Files of other subjects in the folder are recognised and stored too.

**Why:** owner: Google Drive limits the agent's downloads, so the first subject comes in from a browser download; the same reader keeps working for new years without uploads.

**Tested:** 107 unit tests (new: the folder plan, names then first page then AI then library); 196 browser checks (new: a Drive-like folder with names in folders, an unnamed scan named by its cover, a wrong name corrected by the cover, a repeat, a non-PDF, an unclear file picked by hand, five files stored under the right names, a second pick skips them).

## 2026-11-04: Front page reader

**What:** the agent now reads the first page of PDFs, the way a person would. Cambridge prints every cover the same way ("PHYSICS 0625/42, Paper 4 Theory (Extended), May/June 2024, MARK SCHEME"), so the rules read the code, paper, variant, session, year and type from it, with the AI when the layout is unusual. Three uses: (1) in a download run, Drive files whose names say nothing are downloaded and named from their first page before anything goes to "Needs your eye"; files the AI judges are not Cambridge originals are skipped on later runs; (2) every download is checked against its first page before it is stored: stored under the right name when the cover says otherwise, or held back for you; (3) a new "Check library" run reads the stored files of a subject and lists any whose first page does not match their name, with Rename and Remove buttons. The reader is our own small PDF text reader (no outside libraries), so the agent and later the upload page share it. Also: a bare "403" from Google Drive is now described as Google limiting automated downloads (not "downloads turned off"), and the agent stops asking after 3 in a row. The AI may make up to 80 calls per run (was 40).

**Why:** owner: "anything still unclear should run past the AI before it comes to me"; the reader must also work for new years without uploads.

**Tested:** checked against 11 real Cambridge files (question papers, mark schemes, confidential instructions, examiner report, specimens, syllabus, update, grade descriptions): all named correctly; their cover lines are kept as test data. 106 unit tests (new: PDF text from plain, compressed, Type0, object stream, form and letter by letter files; junk and encrypted files; cover rules; AI cover task; rename and remove; check summary); 185 browser checks (new: an unnamed Drive file named from its cover and stored, a misnamed one stored under its cover's name, the library check finds a mismatch and renames it).

## 2026-11-04: Accept or reject on "Needs your eye"

**What:** every Drive file the agent could not place now sits under "Needs your eye" on the run page with the reason (from the rules or the AI) and two buttons. Accept asks which file it is, from this run's missing checklist files described in words (the AI's guess is picked when it has one); Reject drops it. Decisions are saved (`review_decision`, migration 0012), audited and can be undone. Later runs read them: an accepted file is fetched under the chosen name, a rejected one is skipped and counted in the summary. A "Download accepted files" button starts the download. Files the rules could not name now go here too, not only the AI's unsure ones.

**Why:** owner's next pick: decide on unclear files in place instead of adding them by hand.

**Tested:** 99 unit tests (new: report items checked, accept only a missing file this run looks for, one source file per name, runs must be finished, Drive sources only, audit, summary); 178 browser checks (new: reject, undo, accept on the run page, the download fetches the accepted file under its name, a rejected file is skipped by the next run).

## 2026-11-04: Google Drive download refusals handled

**What:** when Google Drive refuses a download, the run now records Google's reason in words (download limit for a busy shared file, slow down, downloads turned off, file gone) instead of "the website answered 403". Downloads are paced a few seconds apart; a limit refusal waits 30 seconds and tries once more; after five refusals in a row the agent stops asking Drive for that run, marks the rest "not tried" and the summary says so, with "run the download again later". A later run fetches only what is still missing.

**Why:** owner report: the Physics download stored 25 files, then Google refused the other 346 one by one, each shown as "the website answered 403", though the files open in a browser.

**Tested:** 95 unit tests (new: Drive refusal reasons, the summary names the Drive limit); 171 browser checks (new: the fake Drive refuses one file with "downloadQuotaExceeded"; the run records it and explains it in words).

## 2026-11-04: Subject map

**What:** each subject's library page now opens on a map of the whole subject: per syllabus version its syllabus documents and specimen papers, then every exam session as a row with each paper as a named column group (question paper, insert, mark scheme, confidential instructions, only where the paper has them) and the examiner report and grade thresholds. Ticks download, crosses add. Essential variants by default, "All variants" shows the rest; coursework and speaking are named as marked by the school. "Download map" gives the same hierarchy as JSON with every file described in words, and the AI engine's catalog now serves exactly that structure.

**Why:** owner request: one first view per subject that shows, for each year and session, every paper type plus the syllabus and other documents, for both people and AI.

**Tested:** 93 unit tests (new: map columns, rows, variants, inserts, school-assessed parts, JSON descriptions); 169 browser checks (new: a table per version, a row per session, named paper columns, document and specimen bands, All variants, Download map, unknown subject).

## 2026-11-04: Run summaries written by rules, reworded by AI

**What:** the summary at the top of a run page is now written by rules from the run's counts: what was found, what was read, real limits (or "Nothing was cut short") and the next step. Workers AI only rewords it; a rewording that adds or changes a number, or claims a limit the draft does not have, is thrown away and the rules' text is shown.

**Why:** owner feedback: the AI summary of the 4 Nov Physics run claimed "the search was limited by the number of website pages read", which was invented.

**Tested:** 91 unit tests (new: summary facts, real limits named, a year no source has, the owner's exact invented sentence rejected, changed numbers rejected); 162 browser checks.

## 2026-11-04: The agent gets judgement (Workers AI) and stops reading what it does not need

**What:** Drive folders are opened only when they can hold what the run wants: a 2026 run no longer walks 2002 to 2025, other subjects' and other sessions' folders stay closed, and each folder reports the years it holds. A bare number like "1524" is no longer taken for a subject code. Cloudflare Workers AI (no key) is called through a new signed endpoint for three things: which unclear folders ("Topical", "Extended") to open, what the files the rules could not name are, and a plain-English summary at the top of the run page. The AI gives parts (year, session, type, paper, variant); the name is built and kept only if the checklist asks for it, otherwise it goes to a new "Needs your eye" list. "Not needed" counts notes and topic questions with examples. Without AI the agent works as before, with a rules summary, and says AI was not used.

**Why:** owner feedback on the 2 Nov Physics 2026 run: it read 1,638 files across 17 years to find nothing, called "1524" a subject, and gave no explanation of 103 unnamed files.

**Tested:** 87 unit tests (new: folder choice, the "1524" case, AI answers checked against the checklist, injection-shaped file names stay data, summary cleaning, per-run cap, unavailable and failing AI); 162 browser checks (new: a 2019 folder is never opened, the run ends with a summary and says AI was not available). Workers AI itself only runs on Cloudflare, so the first real run is its first live test.

## 2026-11-02: Step 2, all 16 IGCSE subjects in the library

**What:** migration 0011 adds the 15 other subjects of the Revisiontown collection (Mathematics, Biology, Chemistry, ICT, Computer Science, Geography, Business Studies, Accounting, Economics, French, Literature in English, English First Language, History, Global Perspectives, Enterprise), each with its syllabus versions for 2022 to 2026, papers, routes, variant 2 as essential and Cambridge's two public pages as start pages. Coursework and speaking components show as "Marked by the school" and are never asked for. Inserts are asked for where the paper comes with one (Geography, Business Paper 2, English, Global Perspectives, Enterprise). The Run page has a subject picker (each subject's library page links to it), the run page names its subject, the Sources page names each start page's subject and lets you pick one when adding, and Home counts files across all subjects. The Physics-only lock is gone.

**Why:** owner decision (option A): the agent read about 10,000 files across 13 subjects but could save only Physics, because the library knew no other subject.

**Checked:** each current syllabus PDF on cambridgeinternational.org (Assessment overview, exam series), the specimen papers listed on each subject page, and the 2023 Geography and History syllabi Cambridge still hosts. Versions Cambridge no longer lists are marked "not checked" on their papers.

**Tested:** 81 unit tests (new: every subject has one version per library year, papers, routes, exam-only checklist papers, variant 2, start pages; runs accept any library subject); 160 browser checks (new: the picker lists every subject by name, the run names its subject, a subject's run link picks it).

## 2026-11-02: Agent reads one subject, and reads any subject's names

**What:** a run now reads only the Drive folders for its own subject: a folder named for another subject ("IGCSE Chemistry (0620)") is skipped without a call to Google, and the run page says how many were skipped. The classifier reads any syllabus code, not only those in the library: a code in brackets first, then a library code, then any four-digit number that is not a year. So "Computer Science (0478) / 2016 / Specimen Papers / 167432-specimen-paper-2-2016.pdf" becomes 0478_y16_sp_2.pdf (counted under other subjects), and a folder like "History (0470)" reads "History (0470), a subject not in the library yet".

**Why:** owner feedback: the agent said "could not tell the subject" for a file whose folder names it, said "not sure" about History (0470), and a Physics run walked all 16 folders and listed thousands of links.

**Tested:** 80 unit tests (new: subjects outside the library, years never taken for codes, the owner's 0478 example); 157 browser checks (new: a folder for another subject is skipped and Google is never asked about it).

## 2026-11-02: Drive folders by name, clearer errors

**What:** migration 0010 names the 16 Revisiontown folders from the subject heading above each link (IGCSE Mathematics (0580) and so on). The agent, the run page and the Sources page now show the folder's name, never its Drive code; the Sources page has an "Open in Google Drive" link instead. A folder Google will not show now says why in words: "does not exist or is not shared publicly", "refused access", or "refused the API key". The run page's failure list reads as sentences.

**Why:** owner feedback: "Google Drive folder 1Ji-VoRo... could not be read: not found" means nothing to a person. That folder is IGCSE Chemistry (0620).

**Tested:** 79 unit tests (seed test now checks every folder has a name); local migration; 156 browser checks, including checks that run and Sources pages never show folder codes and that an unreadable folder is named and explained.

## 2026-11-02: Revisiontown Drive collection seeded

**What:** migration 0009 adds the source "Revisiontown collection (Google Drive)" and the 16 shared folders linked from revisiontown.com's IGCSE past papers page, so the owner does not type them. The folders attach to whichever source has the Drive address, in case one was added by hand.

**Why:** owner feedback: the links were already known and should not have been left for manual entry.

**Tested:** 79 unit tests (new: one Drive source, 16 folders seeded); local migration applied; 153 browser checks (the agent suite now uses its own test Drive address and parks the seeded source during the test).

## 2026-11-02: Google Drive folders as sources

**What**
- Sources: a source with the address `https://drive.google.com/` becomes a Google Drive source; paste many shared folder links at once (one per line), remove one with the inline confirm; each folder shows what the agent last found there.
- Agent: walks each Drive folder tree through Google's official Drive API (API key from the GitHub secret `GOOGLE_DRIVE_API`, sent in a header), works out every PDF's subject, year, session, type, paper and variant from file and folder names, reports each folder's reading and every unclear file with the reason, and downloads only what the run asks for and the library lacks, through the usual checks.
- Run page: "Google Drive folders read" (looks like, PDFs, folders, years, other subjects, errors); "Would download" says how each name was worked out.
- Migration 0008: `source_site.kind`, `source_drive_folder`.
- Brief rule 3.8 updated with the owner's decision.

**Why**
- Owner found a large shared collection (linked from revisiontown.com, held on Google Drive) and wants the agent, not manual downloads, to collect it, and to understand folders and files by itself.
- revisiontown.com's robots.txt blocks AI agents and says ai-train=no, so its pages are never crawled; the owner pastes the Drive links. Google's official API is the sanctioned way into Drive.

**Tested**
- 78 unit tests pass (7 new: Cambridge names in any spelling, descriptive names read with folder help, specimens and syllabus documents, unclear files with reasons, folder readings, Drive link parsing; and a guard that agent scripts load in Node's strip-only mode).
- 153 browser checks, run twice; the agent suite runs a fake Drive API: bulk folder paste, dry run naming files from folder and file names, unclear and other-subject files reported, a private folder reported without stopping the run, the key only ever in a header, run page folder reading and "worked out" notes, download storing four files tagged with Drive links, Sources page showing the folder's contents, and a Drive source refusing non-Drive links.
- Fixed during testing: a constructor shorthand Node cannot run without a compiler (would have failed on GitHub); a syllabus document wrongly needing a session.
- Not tested: the real Google Drive (this session's safety check refused a probe). The first dry run on GitHub is the real test.

## 2026-11-02: Admin is desktop only

**What:** admin browser suites (sign-in, library, agent) now run at desktop width only; the smoke test keeps public pages at 375 px and 1400 px and checks the sign-in page at 1400 px.

**Why:** owner decision: the admin panel stays on the web (desktop); phones are for students.

**Tested:** full e2e suite passes at the new widths (140 checks; the drop from 181 is the phone runs of admin pages); phone checks remain only for public pages.

## 2026-11-02: Agent activity in plain words

**What**
- Activity lines describe what happened instead of file names: "Stored: June 2024, Paper 1 Multiple Choice (Core), variant 1, question paper (1.2 MB)", "Not stored: ... Not a PDF", "Read \"Cambridge IGCSE Physics (0625)\": 27 PDF links. 14 new: June 2024: 6 question papers, 6 mark schemes, ...", a start line saying what the run will do, a robots.txt line that explains it, and a closing summary.
- Run page: "Library after this run" (or "What a download would add" for a dry run) with each session touched, what was added, how many are essential vs extras, its status and a link; file lists grouped by session and described in words; short explanations on "Links not recognised" and "Blocked by robots.txt".
- Events are structured (file, outcome, reason, size), checked on the way in; up to 120 kept per run (was 30).

**Why**
- Owner: the activity showed only file names, which told the admin nothing.

**Tested**
- 71 unit tests pass (4 new: session summaries, page titles, event checking, reasons and version lookup).
- 181 browser checks, run twice. New in the agent suite: page named by its title, robots.txt explained, files described with paper names, failures with reasons in words, closing summary, "Library after this run" links and statuses, lists grouped by session, dry run described and "What a download would add".
- The agent test's local database helper now retries: Wrangler's local tool failed once with "internal error" while the dev server was using the same file.

## 2026-11-01: Papers, routes, variant 2, and the subject overview

**What**
- Subject page is now an overview: status with the most-missing sessions, search and filters that give a short described list, a year by session grid of coloured tiles (one row per year), syllabus version tiles, the papers table and the Core and Extended routes, and the subject's essential variants.
- New pages: one per exam session (whole-session files, the essential variant table with paper names and Core / Extended tags, other variants folded, older and newer links) and one per syllabus version (syllabus documents and specimens).
- Papers and routes per syllabus version (migration 0007): 0625 papers 1 to 6 with format, tier, time, marks and weighting; Core and Extended routes with grade ranges. Checked against Cambridge's syllabus PDFs for 2023 to 2025 and 2026 to 2028.
- Variant 2 is essential (per syllabus, with a library-wide default).
- Files are described in plain words on results, the add page and the catalog API.

**Why**
- Owner: the subject page was too long to read and will grow every year; paper codes (1 MCQ Core, 2 MCQ Extended and so on) matter for the admin and the AI engine; Pakistan sits variant 2.

**Tested**
- 67 unit tests pass (3 new: papers and routes seed, plain-word descriptions, per-syllabus variants; plus a guard against long UNION chains).
- 171 browser checks, run twice: overview grid and rows per year, papers and routes, short overview, session page (breadcrumb, variant 2, paper names, tier tags, pager, unknown session is 404), version page, described search results, download, filters, per-syllabus variants (none refused, saved), add page wording, signed-out and cross-site attempts on the new pages and POST.
- Fixed during testing: the 0007 seed used a six-part UNION ALL, which D1 refuses (unit tests on Node's SQLite passed; the local D1 migration caught it, and CI would have too); long paper names spilled into the next column on phones; uneven grid columns.
- Note: the 14 June 2024 files downloaded earlier are variant 1, so they now count as extras.

## 2026-11-01: Library hierarchy, checklist, search and add-a-file

**What**
- Library home: qualifications (IGCSE, O Level, AS & A Level), each with subject cards showing an essentials bar (green, amber, red) and extras count; search across the whole library.
- Subject page: breadcrumb (Library > qualification > subject), overall status, filters (year, session, type, paper, status) and search, then foldable groups with their own status: syllabus documents and specimens per syllabus version, and every exam session as a table of papers and variants (QP, MS, CI) plus examiner report and grade thresholds. Green tick downloads; a red cross or grey + opens Add.
- Add a missing file: upload any file name (saved under the checklist name) or paste a link from an approved source.
- Settings: essential variants per session (default variant 1, March 2); other variants show as extras.
- New document types: syllabus update and grade descriptions, recognised from Cambridge's links.
- Signed `/api/agent/catalog`: the same tree for the AI engine (metadata only).
- Gaps page removed (its job is now in the library).
- Migration 0006: `qualification`, `subject.qualification_id`, `source_document` rebuilt (types su, gd; origin link), checklist rules, essential variants.

**Why**
- Owner: one neatly organised Library screen by subject with filters and search, status per subject and per document, and a way to add variants from other sources or by hand; hierarchy by qualification for the admin and the AI engine.
- Rebuilding `source_document` breaks "additive only"; the owner approved it once (only test data so far). The test allows that one file by name and checks every column and row is copied.

**Tested**
- 64 unit tests pass (7 new: checklist groups and counts, stored and extra files, essential variants setting, filters and search incl. "paper 4", hierarchy load, rebuilt table, and the rebuild's column copy).
- 134 browser checks, run twice: qualifications and subject cards, search, breadcrumb, cell download, junk filters ignored, Missing filter, subject search, unknown syllabus, add flow (unapproved link refused, upload with any name ticks the cell), signed-out and cross-site attempts on the new pages and POSTs.
- Local migration 0006 on a database with 17 stored files: all 17 kept.
- Fixed during testing: "4" matched every 2024 (numbers now match whole words); specimen table overflowed its card on phones; empty version showed a red 0/0.

## 2026-11-01: Live agent feedback and Cancel

**What**
- Run page while the agent works: progress bar with percentage, current step, time so far and since the last update, an activity log (one line per page and per file, newest first, times to the second), a link to the run's GitHub log, and Cancel run with an inline Yes / Never mind. The page reloads itself every 10 seconds while the run is active and stops when it ends.
- Agent sends a signed update at each step (`/api/agent/progress`) and stops if the run was cancelled.
- Stuck runs: a warning after 5 minutes if GitHub has not started the run; runs with no sign of life for 15 minutes close themselves (was 3 hours), with a message naming the likely cause.
- Migration 0005: `job.heartbeat_at`, `step`, `events`, `run_url`.

**Why**
- Owner asked for reasonable feedback while the agent runs.
- The first production dry run never started: `AGENT_SECRET` was under GitHub's Agents secrets, not Actions. The run sat "Waiting to start" with no explanation and blocked new runs for 3 hours.
- Auto-reload uses a meta refresh rather than script, keeping to the brief's no-AJAX rule.

**Tested**
- 57 unit tests pass (4 new: progress updates and event cap, cancel, 15 minute rule for never-started and quiet runs, cleaning of agent text and GitHub links).
- 111 browser checks, run twice. New: live updates arrive, progress bar, auto-refresh on then off, activity log, time so far, no sideways scroll at 375 px, cancel mid-run (asks first, run shows Cancelled, agent stops itself), never-started run explains the cause.
- Fixed during testing: a file that failed to download had no activity line; reasons now read in plain words.

## 2026-11-01: Acquisition agent and settings (build 3b)

**What**
- `/admin/agent`: choose years, sessions (including Specimen) and dry run or download; Run starts GitHub Actions. Run list and run report (found, stored, not stored with reasons, links not recognised, robots.txt blocks, page errors). A dry run offers "Download these N files".
- `scripts/agent/run.ts` and `.github/workflows/agent.yml`: the agent. robots.txt first, start pages only, same-site PDF links only, 5 second gaps, honest name, no logins, no off-site redirects, at most 400 files per run, skips what is stored.
- Signed agent endpoints `/api/agent/job`, `/file`, `/finish` (HMAC, clock window, single-use nonce). Files go through the same store path as uploads.
- `/admin/settings`: library years and latest public session moved from code to the database.
- Start pages per source on `/admin/sources`, seeded with Cambridge's 0625 past-papers and overview pages.
- Migration 0004: `setting`, `source_page`, `request_nonce`.

**Why**
- Owner chose the Run button, selectable years and sessions, and a settings page, so new sessions can be added later without code.
- Agent in TypeScript (not Python) so it shares the Cambridge name rules with the library.
- The GitHub token needs only Actions access, not Contents, so a leaked token cannot change code.
- Built against Cambridge's real pages (fetched once, politely): robots.txt allows the PDFs; their names were used to write and test the translation.

**Found**
- Cambridge's public 0625 pages carry only June 2024 (variant 1 of each paper), the 2023 specimens and syllabus PDFs: 33 links, 30 usable. The rest of 2022 to 2026 is not public there.
- Syllabus versions confirmed on Cambridge's site: 2023 to 2025 and 2026 to 2028 (and a 2029 syllabus).

**Tested**
- 53 unit tests pass (11 new: signatures, replay guard, robots.txt incl. Cambridge's real file, real Cambridge names, link filtering, settings, run choices, one-run-at-a-time and stale runs, start pages; plus the http-only CSP rule).
- Typecheck, inline check, build, local migration 0004.
- 97 browser checks, run twice: all earlier suites plus a new agent suite against a fake source site (Run button without a token, dry run, robots.txt block, unknown links, download run storing 4 real PDFs and refusing a fake one, a 404 reported, re-run skips stored files, settings, unsigned / replayed / wrong-secret / old / off-site agent requests refused).
- Real dry run against Cambridge from the local Worker: 2 pages, 33 PDF links, 25 to fetch, 3 not recognised (syllabus update notes, grade descriptions), nothing downloaded.
- Fixed during testing: question papers are named "question-paper-11" (no "-paper"); the CSP's upgrade rule broke page prefetches on the local http server; test scripts tripped on Next's hidden alert element.
- Not tested: the real GitHub dispatch and a production run (need the owner's secrets).

## 2026-11-01: Source library (build 3a)

**What**
- Admin pages: library (filters, grouped by session), gap report, multi-file upload with per-file results, approved sources (add, switch on or off, remove with inline confirm).
- Migration 0003: `subject`, `syllabus` (three 0625 versions), `source_site` (Cambridge official seeded), `source_document`; `job` gains `created_by` and `result`.
- One store path for uploads and the coming agent; one rate limiter for every write (sign-in moved onto it); jobs helper.
- Admin-only, audited downloads as attachments.

**Why**
- Owner moved the acquisition agent forward; the library is where its files land and where the AI steps will read them. Split into 3a (library) and 3b (agent), owner agreed.
- Physics 0625, 2022 to 2026 (owner decisions). Files are tagged with the syllabus version for their year, so later steps can prefer the current one.
- Files are reserved in the database before writing to storage, so two uploads of the same file cannot overwrite each other.

**Tested**
- 42 unit tests pass (15 new: 14 for the library, name parser, gap rules, PDF check, store with version pick, rejections, duplicates, parallel uploads, storage failure clean-up, source address rules, source changes audited, seed, jobs, a check that only admin code touches the source bucket, and 1 for the rate limiter).
- Typecheck, inline check, build, local migration 0003.
- Browser at 375 px and 1400 px (40 checks): upload with good, badly named and fake files; library listing; download as an attachment; junk filters ignored; gap report; sources add, refused IP address, switch off, inline confirm, Never mind, remove; no sideways scroll; no script or CSP errors. Signed out, every library page and download redirects to sign-in; cross-site and signed-out POSTs are refused. Run twice to cover re-uploads.
- Fixed during testing: two test-script bugs (clicked Sign out instead of Upload; did not wait for page changes), a seed time one day in the future, Sign out wrapping on phones.
- Not tested: real Cambridge files (no network access to Cambridge from this session).

## 2026-11-01: Admin sign-in (Step 1-lite)

**What**
- `/admin/login` (password form), `/admin` (admin home with recent activity), sign-out.
- Migration 0002: `admin_session`, `login_attempt`, `audit_log`.
- Route access list (`PUBLIC_ROUTES`) with a test that every page and route is either listed or checks the admin session.
- Same-origin check on every POST; same-site-only redirect helper.

**Why**
- Owner moved the source library and acquisition agent forward. Source files are admin only and every access must be audited (brief 3.2), so a sign-in is needed first. Owner chose one platform admin with a password for now; Better Auth with email codes and Google comes later.
- Attempts are counted before the password check, so a burst of parallel requests cannot get more than 5 guesses.

**Tested**
- 27 unit tests pass (13 new: password compare, sign-in, lockout and window reset, parallel burst, counter clear, expiry, junk tokens, sign-out, audit content, same-origin, redirects, route access).
- Typecheck, inline check, OpenNext build, local migration 0002.
- Browser, at 375 px and 1400 px: signed-out redirect, wrong password message, sign-in, cookie flags, activity list, no sideways scroll, sign-out, replayed old cookie refused, no script or CSP errors. Attacker checks: cross-site and Origin-less POST refused, forged cookie refused, 6th try locked even with the right password, other networks unaffected.

## 2026-11-01: Fix first production deploy

**What:** `npm run build` now generates the binding types (`cf:types`) before `next build`.

**Why:** the first deploy on `main` failed. The deploy job builds without running typecheck first, so `cloudflare-env.d.ts` (not committed) was missing and Next's type check could not see `DB`, `FILES`, `SOURCE` and `APP_NAME`. The token, D1 lookup and production migration all worked.

**Tested:** deleted `cloudflare-env.d.ts`, ran `npm run build:worker` from clean: types generated, build passes.

## 2026-11-01: Step 0, repo and CI

**What**
- Next.js 16 app on Cloudflare Workers through OpenNext, with D1 (`cambridge`) and two private R2 buckets (`cambridge` for app files, `cambridge-source` for Cambridge documents).
- Security headers and a per-request CSP nonce on every response; static files covered by `public/_headers`.
- Error helper that shows visitors a reference id only.
- `/health` checks D1 and both buckets, pass or fail only.
- First migration: `job` table.
- CI: typecheck, unit tests, inline check, build, local migrations, browser smoke test; on `main` also production migrations, deploy and a health check.
- Docs: brief, CLAUDE.md, README, feature list, dev checklist, tests README.

**Why**
- Brief step 0. A second bucket keeps Cambridge source files apart, so they can never be served by mistake.
- Vitest was dropped for Node's own test runner: Vitest hit an npm peer dependency error, and the built-in runner needs no dependency.
- Edge `middleware.ts` instead of Next 16 `proxy.ts`: OpenNext marks Node middleware as experimental.

**Tested**
- 14 unit tests pass (headers, CSP, error refs, additive migrations, Worker config, inline check). One caught a real bug: the error logger could throw on a hostile value. Fixed.
- Typecheck and `check:inline` pass.
- OpenNext build passes; local migration applied.
- Local Worker: `/health` returns ok with all security headers; browser smoke test passes at 375 px and 1400 px (no sideways scroll, no script or CSP errors, every script has the nonce).
- Not tested yet: the production deploy (runs in CI after merge to `main`).
