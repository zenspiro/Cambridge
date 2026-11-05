# Features

A plain list of what the platform does today, for non-developers.

## Live
- A placeholder home page.
- A health page (`/health`) that says whether the database and file storage are working.

- Admin sign-in with a password, at `/admin/login`. After 5 wrong tries from one network, sign-in pauses for 15 minutes.
- Admin home showing recent activity.
- Library (admin only): Cambridge files organised by qualification (IGCSE, O Level, AS & A Level) and subject. Each subject has a status bar: green when every essential file is in. 16 IGCSE subjects are in: Physics, Mathematics, Biology, Chemistry, ICT, Computer Science, Geography, Business Studies, Accounting, Economics, French, Literature in English, English First Language, History, Global Perspectives and Enterprise. Coursework and speaking parts are listed as marked by the school; inserts count where a paper comes with one.
- Inside a subject: an overview with the status, the sessions missing most, a subject map (every syllabus version with its documents and specimens, then every session with each paper's files, ticked or missing; "Download map" gives the same as a file for the AI), and the papers (for example Paper 2: Multiple Choice, Extended) with the Core and Extended routes. Search and filters give a short list described in plain words.
- One page per exam session: every paper with its name and Core or Extended tag; a green tick downloads, a red cross is a missing essential file, a grey + is an optional extra (other variants).
- Variant 2 counts as essential, because that is what Pakistan sits. Each subject can change this.
- Add any missing file from its cell: upload it (any file name) or paste a link from an approved website.
- Upload: add up to 20 Cambridge PDFs at once; wrong names, non-PDFs and duplicates are skipped with a reason.
- Approved sources: the list of websites the download agent may visit, which the admin can add to, switch off or remove, with the start pages the agent reads on each.
- Sources page: one card per subject with its Cambridge pages (and how many of their files are not in the library yet) and its Google Drive folders; add pages or folders right on the subject.
- Google Drive collections: paste shared folder links on the Sources page; the agent reads the folders, works out what every file is (subject, year, session, paper, variant) from the folder and file names, and takes only what is missing. A run reads only the folders for its own subject and skips the rest. The agent opens only folders that can hold the years and sessions you asked for, and tells you which years a folder holds. Cloudflare's AI helps with what the rules cannot read: unclear folder names, files with unclear names (only files your checklist asks for are kept; the rest go to "Needs your eye"), and a short summary at the top of every run. Under "Needs your eye" you accept a file (choosing which paper it is) or reject it; later runs remember, so accepted files are fetched under that name and rejected ones are skipped. The front page reader reads the first page of a PDF like a person would: in a download, files with unclear names are named from their cover first, every download is checked against its cover before it is stored, and "Check library" on the Run page reads the files you already hold and offers Rename or Remove for any that do not match. Pick the subject on the Run page, or press "Run the agent for this subject" on its library page.
- Download agent: pick years and sessions, do a dry run to see what it would fetch, then download only the missing files. It reads each site's robots.txt, waits between requests and never logs in.
- Live run page: progress bar, current step, time so far, and a plain-words line for every page and file (for example "Stored: June 2024, Paper 1 Multiple Choice (Core), variant 1, question paper"), a link to the GitHub log, and a Cancel button. It updates itself every 10 seconds.
- After a run: what changed in the library, session by session, with how many of the files were essential.
- Settings: library years, the latest public exam session, and which variants count as essential.

## Coming next
- Student sign-in with an email code or Google.
- Upload a folder (Library > Upload): pick an unzipped Google Drive folder. Every PDF is worked out from its folder names, its first page and the AI, you check the preview, then the files are uploaded one at a time. Files already stored are skipped, so you can pick the same folder again later. Pre-release material (Computer Science), listening transcripts and teachers' notes (French) are recognised and stored; Every real Cambridge file of a library subject comes in, even kinds or papers the checklist does not ask for (like ICT source files), and shows as an extra. Where the AI has a guess for an unclear file it is already chosen for you. "Download report" saves a spreadsheet of every file and what happened to it. Papers Cambridge set under another code for a country series (Physics 1524, Pakistan 2021) are stored with their subject and shown in that session as their own series; a new such code is linked from the first page by itself. If a file's cover names a paper differently from the library, the page lists it.
- AI meter: the top of every admin page shows how many AI questions were asked today and about how much of the free daily allowance they used.
