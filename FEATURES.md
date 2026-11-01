# Features

A plain list of what the platform does today, for non-developers.

## Live
- A placeholder home page.
- A health page (`/health`) that says whether the database and file storage are working.

- Admin sign-in with a password, at `/admin/login`. After 5 wrong tries from one network, sign-in pauses for 15 minutes.
- Admin home showing recent activity.
- Library (admin only): Cambridge files organised by qualification (IGCSE, O Level, AS & A Level) and subject. Each subject has a status bar: green when every essential file is in.
- Inside a subject: the syllabus documents, specimens and every exam session laid out as a checklist. A green tick downloads the file; a red cross means an essential file is missing; grey + is an optional extra (other variants). Filters and a search box narrow it down.
- Add any missing file from its cell: upload it (any file name) or paste a link from an approved website.
- Upload: add up to 20 Cambridge PDFs at once; wrong names, non-PDFs and duplicates are skipped with a reason.
- Approved sources: the list of websites the download agent may visit, which the admin can add to, switch off or remove, with the start pages the agent reads on each.
- Download agent: pick years and sessions, do a dry run to see what it would fetch, then download only the missing files. It reads each site's robots.txt, waits between requests and never logs in.
- Live run page: progress bar, current step, time so far, a line for every page and file, a link to the GitHub log, and a Cancel button. It updates itself every 10 seconds.
- Settings: library years, the latest public exam session, and which variants count as essential.

## Coming next
- Student sign-in with an email code or Google.
