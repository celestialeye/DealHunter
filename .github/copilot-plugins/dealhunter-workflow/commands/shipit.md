---
description: Close the current DealHunter task, validate it, commit it, push it, and open or update a PR
argument-hint: Optional additional scope, intent, or issue reference
---

# Ship DealHunter Work

Close the current DealHunter task end-to-end and leave it ready for review.

Additional scope or intent from the user:

$ARGUMENTS

Follow `AGENTS.md`, repository instructions, and the applicable documentation.
Treat the current conversation, todo state, git diff, untracked files, recent
commits, and current pull request as evidence of the task's intended scope.
Execute the workflow rather than merely describing it.

## 1. Establish scope and safety

- Inspect the current branch, repository default branch, status, staged and
  unstaged diffs, untracked files, recent commits, remotes, and any pull
  request for the branch.
- Identify the cohesive task being shipped and distinguish its files from
  unrelated or pre-existing user work.
- Never discard, overwrite, stash, reset, or stage unrelated changes. Stop
  before committing if intended and unrelated edits are inseparable.
- Scan task files for credentials, private data, runtime databases, encrypted
  secrets, cached product images, learning artifacts, browser traces, test
  output, logs, and generated build directories.
- Never stage `.dealhunter/`, `.dealhunter-test/`, `.next/`,
  `playwright-report/`, `test-results/`, environment files, or secret files.

## 2. Finish and review the implementation

- Resolve task-owned placeholders, debug code, temporary instrumentation,
  incomplete todos, and directly related defects.
- Review the complete task diff for correctness, failure behavior, data
  contracts, type safety, concurrency, security, and accidental files.
- Read the relevant guide under `node_modules/next/dist/docs/` before changing
  Next.js APIs, route conventions, rendering behavior, or framework config.
- Use an independent code-review agent for nontrivial monitoring, purchase,
  outbound-action, concurrency, security-sensitive, or broad cross-layer
  changes. Skip it for straightforward documentation, copy, configuration, or
  tiny fixes.
- Prefer surgical fixes and preserve existing behavior outside the task.

## 3. Reconcile documentation and memory

- Update only documentation directly affected by the change, including
  `README.md`, operational guidance, data contracts, and inline help.
- Preserve durable investigation and methodology records unless they are
  clearly obsolete and task-owned.
- Store only genuinely new, durable, non-sensitive repository facts that will
  help future work. Upvote verified existing memories instead of duplicating
  them, and downvote outdated memories.

## 4. Validate in layers

- Run the smallest focused test, lint, or type-check command that covers the
  changed behavior first.
- Run the complete offline merge gate:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

- For UI, routing, browser workflow, or end-to-end behavior changes, also run
  `npm run test:e2e`. This command owns its test server and uses port 3100.
- Do not run live retailer scans, monitor learning, cart execution, outbound
  actions, or purchase workflows as substitutes for tests.
- Fix failures caused by the task. Report unrelated baseline failures
  precisely and do not conceal them.

## 5. Prepare reviewable git history

- If currently on the repository default branch, create a focused branch using
  a `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `ci/`, or `chore/`
  prefix.
- Stage explicit task files only. Re-check the staged diff and generated-file
  boundaries before committing.
- Create logical Conventional Commits with the required Copilot co-author
  trailer.
- Never amend, force-push, rewrite history, bypass hooks, or merge
  automatically unless the user explicitly requests it.

## 6. Push and create the review boundary

- Push the branch to `origin` with upstream tracking.
- Create a pull request against the repository default branch, or update the
  existing pull request for the branch.
- Use a concise Conventional Commit-style title and a body covering the
  summary, validation, and any material caveat.
- Do not merge automatically. Report the status of any checks configured for
  the pull request.

## 7. Leave a precise handoff

- Remove only task-owned temporary files after inspecting their exact paths.
- Confirm the task files are committed and pushed without disturbing unrelated
  working-tree changes.
- Finish with the branch, commit or commits, pull-request link, validation
  result, and any explicit blocker.
