# Admin guide

## Signing in
1. Go to `/admin` on the site. You land on the sign-in page.
2. Type the admin password and press Sign in.
3. You stay signed in for 12 hours, or until you press Sign out.

The password is the `ADMIN_PASS` secret in the Cloudflare dashboard (Worker `cambridge`, Settings, Variables and Secrets). To change it, edit the secret there. It must be at least 12 characters, or sign-in switches off.

## If sign-in is locked
After 5 wrong tries from one network, sign-in pauses for 15 minutes from the first try. Other networks are not affected.

## Recent activity
The admin home lists the latest sign-ins, sign-outs, wrong passwords and lockouts, in Pakistan time.

## Library
Cambridge files by qualification (IGCSE, O Level, AS & A Level) and subject. Only admins can see it, and every download is written to the activity log.

- **Library home:** one card per subject with a bar: green when every essential file is in, amber when some are, red when none are. The search box looks across every subject (for example "mark scheme 2024 paper 4", or a file name).
- **A subject:** click its card for the overview:
  - **Status** and the sessions with the most missing files.
  - **Search and filters:** type words or pick a status, year, session, type or paper; you get a short list in plain words ("June 2024, Paper 2 Multiple Choice (Extended), variant 2, mark scheme") with Download or Add.
  - **Exam sessions grid:** one row per year, one tile per session. Green: complete, amber: some, red: none, dashed: not public yet. Click a tile to open that session.
  - **Syllabus and specimens:** one tile per syllabus version.
  - **Papers:** what each paper is, its time and marks, and the Core and Extended routes.
  - **Essential variants for this subject:** tick which variants must be stored (Pakistan sits variant 2).
- **A session page:** the examiner report and grade thresholds, then the essential variant's papers (with names and Core or Extended tags; columns QP question paper, MS mark scheme, CI confidential instructions), then other variants folded underneath. Use the arrows to step to the session before or after.
- **Ticks and crosses:** a green tick downloads the file. A red cross is an essential file that is missing. A grey + is an extra (another variant) not yet stored.
- **Adding a missing file:** click its cross or +. Upload the PDF from your computer (any file name; it is saved under the right Cambridge name) or paste a link from an approved source.
- **Upload (bulk):** for many files at once, they must already have Cambridge names, like `0625_s23_qp_42.pdf`.

## Approved sources
The websites the download agent may visit. It starts with Cambridge's official site.

- **Add:** a name and a full https address. IP addresses, logins and local addresses are refused.
- **Switch off / on:** the agent skips switched-off sources.
- **Remove:** asks "Remove this source?" first. Choose Yes, remove or Never mind. Files already downloaded from it stay in the library.

Only add a source if you are sure its files may be used (brief section 3).

## Google Drive folders
The Revisiontown collection (16 folders) is already set up as a source. To add another collection:
1. Sources page: add a source named for the collection (for example "Revisiontown Drive") with the address `https://drive.google.com/`. It becomes a Google Drive source.
2. Under it, paste the shared folder links, one per line (up to 50 at a time), and press Add folders. Duplicates and lines that are not folder links are skipped and counted.
3. Run the agent (dry run first). It reads only the folders for the run's subject (by the folder name, for example "IGCSE Physics (0625)") and skips the others. The run page shows "Google Drive folders read": what each folder looks like (for example "IGCSE Physics 0625"), how many PDFs and years it holds, and files for other subjects. "Would download" lists each file with how its name was worked out; "Links not recognised" lists files it could not read, with the reason.
4. Each folder on the Sources page then shows what the agent last found there.

The folders must be shared as "anyone with the link". A folder that needs an invitation shows "access denied" in the run. First-time setup: the `GOOGLE_DRIVE_API` key in GitHub (`agent-setup.md`).

## Start pages
Each source lists the pages the agent reads (under "Start pages" on the Sources page). The agent only follows PDF links on these pages that stay inside the source's address. Add a page with its full https address; remove one with "Remove page", then "Yes, remove" or "Never mind". A source with no start pages is skipped.

## Download agent
1. Agent page: tick the years and sessions to look for. "Specimen" means specimen papers and syllabus documents.
2. Keep **Dry run** the first time. Press Run agent.
3. The run page follows the run by itself (it reloads every 10 seconds): a progress bar, the current step, time so far, and a line for every page read and file stored or skipped. "GitHub log" opens the agent's own log. A run waits 5 seconds between requests, so allow a few minutes.
4. When it finishes, read "What a download would add": each session it found files for, and how many are essential. "Would download" lists every file in words. If it looks right, press **Download these files**.
5. After a download, "Library after this run" shows each session that changed, its new status, and a link to it. The activity log says, file by file, what was stored or why not.
6. Files already in the library are never fetched again. "Links not recognised" lists PDFs whose names the agent could not read; upload those by hand if you need them.

Only one run can go at a time. To stop one, press **Cancel run**, then **Yes, cancel**. If GitHub has not started a run after 5 minutes, the page warns you; a run that stays silent for 15 minutes closes itself and says why. The usual cause of a run that never starts: `AGENT_SECRET` missing from GitHub's **Actions** secrets (not the "Agents" section). First-time setup: `agent-setup.md`.

## Settings
- **From year / To year:** the years the library keeps (at most 15 years apart).
- **Latest public session:** the newest exam session whose papers are public. The library does not ask for later sessions.
- **Default essential variants:** used only for a subject without its own setting (each subject sets its own on its overview). Currently variant 2.

When a new session's papers come out: move the latest public session forward, then run the agent for just that session.
