# Setting up the download agent

Two secrets, set once. Nobody else needs to see their values.

## 1. A shared secret (AGENT_SECRET)
This lets the agent prove to the site that it is really our agent.

1. Make a long random value, at least 32 characters, with a password manager's generator (letters and digits).
2. GitHub: the Cambridge repository, Settings, Secrets and variables, Actions, New repository secret. Name `AGENT_SECRET`, paste the value.
3. Cloudflare: Workers, `cambridge`, Settings, Variables and Secrets, Add. Type **Secret**, name `AGENT_SECRET`, paste the same value.

## 2. A GitHub token (GITHUB_TOKEN)
This lets the Run agent button start the agent on GitHub.

1. GitHub: your profile, Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
2. Name: "Cambridge agent button". Expiration: 1 year (set a reminder to renew).
3. Repository access: Only select repositories, choose `zenspiro/Cambridge`.
4. Permissions, Repository permissions: **Actions: Read and write**. Leave everything else as No access. (Contents is not needed, so the token cannot change code.)
5. Generate, copy the token.
6. Cloudflare: Workers, `cambridge`, Settings, Variables and Secrets, Add. Type **Secret**, name `GITHUB_TOKEN`, paste.

## 3. Check it
1. Admin panel, Agent. Tick a year and a session, keep Dry run, press Run agent.
2. The run page says "Waiting to start", then "Running". Press Refresh after a minute or two.
3. If it says the agent is not set up, or GitHub refused the token, the message names what to fix.

The agent only works once `.github/workflows/agent.yml` is on the `main` branch.
