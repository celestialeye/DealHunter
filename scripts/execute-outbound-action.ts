import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cartProductKey } from "../src/lib/cart-actions";
import { executeCartAction } from "../src/lib/cart-executor";
import {
  isApprovedOutboundAction,
  parseOutboundActionIssue,
} from "../src/lib/outbound-actions";

interface GitHubIssue {
  body: string | null;
  labels: Array<string | { name?: string }>;
  state: "open" | "closed";
  updated_at: string;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function issueNumberFromArguments(): number {
  const index = process.argv.indexOf("--issue-number");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  const issueNumber = Number(value);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Pass a positive issue number with --issue-number.");
  }
  return issueNumber;
}

async function githubRequest<T>(
  repository: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  const token = requiredEnvironmentVariable("GITHUB_TOKEN");
  const response = await fetch(
    `https://api.github.com/repos/${repository}${endpoint}`,
    {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(5_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub API ${init.method ?? "GET"} ${endpoint} failed with ${response.status}.`,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function issueLabelNames(issue: GitHubIssue): string[] {
  return issue.labels.flatMap((label) => {
    if (typeof label === "string") return [label];
    return label.name ? [label.name] : [];
  });
}

function approvedIssueDigest(issue: GitHubIssue) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        body: issue.body ?? "",
        labels: issueLabelNames(issue).sort(),
        state: issue.state,
      }),
    )
    .digest("hex");
}

function isIssueApproved(issue: GitHubIssue) {
  return (
    issue.state === "open" &&
    isApprovedOutboundAction(issueLabelNames(issue))
  );
}

async function addIssueComment(
  repository: string,
  issueNumber: number,
  body: string,
) {
  await githubRequest(repository, `/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function main() {
  const repository = requiredEnvironmentVariable("GITHUB_REPOSITORY");
  const issueNumber = issueNumberFromArguments();
  const issue = await githubRequest<GitHubIssue>(
    repository,
    `/issues/${issueNumber}`,
  );
  const approvedBody = requiredEnvironmentVariable("APPROVED_ISSUE_BODY");
  const approvedUpdatedAt = requiredEnvironmentVariable(
    "APPROVED_ISSUE_UPDATED_AT",
  );
  const approvalAgeMs =
    Date.now() - new Date(approvedUpdatedAt).getTime();
  if (
    issue.body !== approvedBody ||
    issue.updated_at !== approvedUpdatedAt ||
    !Number.isFinite(approvalAgeMs) ||
    approvalAgeMs < 0 ||
    approvalAgeMs > 10 * 60_000
  ) {
    throw new Error(
      `Issue #${issueNumber} no longer matches the recent approval event.`,
    );
  }
  if (!isIssueApproved(issue)) {
    throw new Error(`Issue #${issueNumber} is not approved.`);
  }

  const action = parseOutboundActionIssue(issue.body ?? "");
  const approvalDigest = approvedIssueDigest(issue);
  const approvalDirectory = mkdtempSync(
    path.join(tmpdir(), "dealhunter-github-approval-"),
  );
  const approvalFilePath = path.join(approvalDirectory, "action.approved");
  writeFileSync(
    approvalFilePath,
    JSON.stringify({
      token: approvalDigest,
      expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
    }),
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  let approvalWatcherRunning = true;
  const approvalWatcher = (async () => {
    while (approvalWatcherRunning) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!approvalWatcherRunning) break;
      try {
        const currentIssue = await githubRequest<GitHubIssue>(
          repository,
          `/issues/${issueNumber}`,
        );
        if (
          !isIssueApproved(currentIssue) ||
          approvedIssueDigest(currentIssue) !== approvalDigest
        ) {
          rmSync(approvalFilePath, { force: true });
          break;
        }
      } catch {
        rmSync(approvalFilePath, { force: true });
        break;
      }
    }
  })();
  try {
    const result = await executeCartAction({
      productUrl: action.productUrl,
      productKey: cartProductKey("retailer-target", action.productUrl),
      retailerId: "retailer-target",
      profileName: requiredEnvironmentVariable(
        "DEALHUNTER_CHROME_PROFILE_NAME",
      ),
      approvalFilePath,
    });
    await addIssueComment(
      repository,
      issueNumber,
      result.added
        ? `Outbound action completed: exact product quantity ${result.baselineProductQuantity} → ${result.finalProductQuantity}, total cart units ${result.baselineCartUnits} → ${result.finalCartUnits}. No checkout or purchase was attempted.`
        : `Outbound action completed without adding a duplicate: the cart already contained ${result.finalProductQuantity} unit(s) of the exact product. No checkout or purchase was attempted.`,
    );
    await githubRequest(repository, `/issues/${issueNumber}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown execution error.";
    await addIssueComment(
      repository,
      issueNumber,
      `Outbound action failed without attempting checkout: ${detail}`,
    );
    throw error;
  } finally {
    approvalWatcherRunning = false;
    await approvalWatcher;
    rmSync(approvalDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
