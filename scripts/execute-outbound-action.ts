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
  if (issue.state !== "open") {
    throw new Error(`Issue #${issueNumber} is not open.`);
  }
  if (!isApprovedOutboundAction(issueLabelNames(issue))) {
    throw new Error(`Issue #${issueNumber} is not approved.`);
  }

  const action = parseOutboundActionIssue(issue.body ?? "");
  try {
    const result = await executeCartAction({
      productUrl: action.productUrl,
      productKey: cartProductKey("retailer-target", action.productUrl),
      retailerId: "retailer-target",
      profileName: requiredEnvironmentVariable(
        "DEALHUNTER_CHROME_PROFILE_NAME",
      ),
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
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
