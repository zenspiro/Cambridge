# Topic tree: setup and use

The topic tree is step 1 of the subject brain. For each syllabus version, Claude copies the topics and learning goals
from the syllabus PDF. Code checks every word against the PDF and the numbering, and Gemini (from Google) copies the
same syllabus separately so the two can be compared. A tree is marked **Ready** only when every check passes. No
subject expert is needed.

## One-time setup (owner)

Three GitHub secrets, set in GitHub > the Cambridge repository > Settings > Secrets and variables > Actions >
New repository secret. Put them under **Actions**, not "Agents" (the agent's first run failed because of that).

1. `CLAUDE_API_KEY`: an API key from the Claude Console (platform.claude.com > API keys). Add credit to the account first.
2. `GEMINI_API_KEY`: an API key from Google AI Studio (aistudio.google.com > Get API key).
3. `AGENT_SECRET`: already set for the download agent. The same secret is used here.

The Worker's `GITHUB_TOKEN` (already set for the agent) starts the runs.

Then open Admin > Settings > **AI setup** and press **Check Claude** and **Check Gemini** (each has its own button). It runs on GitHub with your keys and shows
whether Claude works and which Gemini models your key can use: "Works", "Not on your plan" (no free use of that
model), "Limit reached for now", or "Key refused". Press **Use this model** on a working Gemini model to choose it. Run
the check again whenever a run says the Gemini model is unknown (Google renames models from time to time).
Both models are picked on the AI setup page (dropdowns); `wrangler.jsonc` (`CLAUDE_MODEL` claude-sonnet-5-5, `GEMINI_MODEL`) only gives the defaults.

## Drafting a tree

1. The syllabus PDF for the version must be in the library (Library > subject > the version's page).
2. Library > subject > **Topic tree**.
3. Press **Draft topic tree** on the version. A run takes a few minutes, and the page updates by itself.
4. When it finishes, the version says **Ready** (with the counts) or **Not ready**.
5. **Open the tree** to browse it. "Not ready" lists the checks still open and any differences between Claude and
   Gemini; those goals are highlighted. **Redraft** tries again; the current tree stays until the new one is saved.

## What it costs

About one to two dollars of Claude per syllabus version (Claude reads the whole PDF, sometimes twice), and a few cents
of Gemini. Each version only needs drafting once.

## If a run stops

The version shows the reason in plain words, for example a missing or refused key. Fix it, then press Draft again.

## Spend and the cap

- Admin > Settings > AI setup shows usage and spend per model and per job, this month and earlier months.
- Spend comes from the tokens each service reports and the prices on the page (dollars per million tokens). Claude's are filled in; type Gemini's (0 on the free tier).
- Set a monthly cap to stop runs that would go past it. With a cap, every model in use needs a price.
- The figures are estimates. The real bill is on the Anthropic Console (Plans & Billing) and in Google AI Studio.
