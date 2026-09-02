import fs from "node:fs";
import path from "node:path";

import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

import {
  isApprovedOutboundAction,
  parseOutboundActionIssue,
} from "../src/lib/outbound-actions";

interface GitHubIssue {
  body: string | null;
  html_url: string;
  labels: Array<string | { name?: string }>;
  state: "open" | "closed";
  title: string;
}

interface BrowserSession {
  context: BrowserContext;
  close: () => Promise<void>;
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
): Promise<void> {
  await githubRequest(repository, `/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function closeIssue(
  repository: string,
  issueNumber: number,
): Promise<void> {
  await githubRequest(repository, `/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}

async function openChromeSession(): Promise<BrowserSession> {
  const cdpUrl = process.env.TARGET_CHROME_CDP_URL?.trim();
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error("Chrome CDP connection has no browser context.");
    }

    return {
      context,
      close: () => browser.close(),
    };
  }

  const localAppData = requiredEnvironmentVariable("LOCALAPPDATA");
  const userDataDirectory =
    process.env.TARGET_CHROME_USER_DATA_DIR?.trim() ||
    path.join(localAppData, "Google", "Chrome", "User Data");
  const profileDirectory =
    process.env.TARGET_CHROME_PROFILE?.trim() || "Default";

  if (!fs.existsSync(userDataDirectory)) {
    throw new Error(
      `Chrome user data directory does not exist: ${userDataDirectory}.`,
    );
  }

  const context = await chromium.launchPersistentContext(userDataDirectory, {
    args: [`--profile-directory=${profileDirectory}`],
    channel: "chrome",
    headless: false,
    viewport: null,
  });

  return {
    context,
    close: () => context.close(),
  };
}

async function firstVisibleEnabled(locator: Locator): Promise<Locator | null> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if ((await candidate.isVisible()) && (await candidate.isEnabled())) {
      return candidate;
    }
  }
  return null;
}

async function targetCartItemCount(page: Page): Promise<number | null> {
  const label = await page
    .locator('a[data-test="@web/CartLink"]')
    .first()
    .getAttribute("aria-label");
  const match = label?.match(/^cart\s+(\d+)\s+items?$/i);
  return match ? Number(match[1]) : null;
}

async function addTargetItemToCart(productUrl: string): Promise<void> {
  const session = await openChromeSession();
  const page = await session.context.newPage();
  try {
    const response = await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    if (!response || response.status() === 403 || response.status() === 429) {
      throw new Error(
        `Target returned HTTP ${response?.status() ?? "unknown"}.`,
      );
    }

    await page.locator("h1").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const addToCartButtons = page.locator(
      'button[data-test="shippingButton"]',
      {
        hasText: "Add to cart",
      },
    );
    await addToCartButtons.first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const addToCartButton = await firstVisibleEnabled(addToCartButtons);
    if (!addToCartButton) {
      throw new Error("Target did not present an enabled Add to cart button.");
    }

    const cartCountBefore = await targetCartItemCount(page);

    try {
      await addToCartButton.click({ timeout: 5_000 });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("styles_overlay__") ||
        !error.message.includes("intercepts pointer events")
      ) {
        throw error;
      }
      await addToCartButton.click({ force: true, timeout: 5_000 });
    }

    if (cartCountBefore !== null) {
      await page.waitForFunction(
        (previousCount) => {
          const label = document
            .querySelector('a[data-test="@web/CartLink"]')
            ?.getAttribute("aria-label");
          const match = label?.match(/^cart\s+(\d+)\s+items?$/i);
          return match ? Number(match[1]) === previousCount + 1 : false;
        },
        cartCountBefore,
        { timeout: 20_000 },
      );
    } else {
      await Promise.any([
        page
          .getByText(/added to cart/i)
          .first()
          .waitFor({ state: "visible", timeout: 20_000 }),
        page
          .getByRole("link", { name: /view cart/i })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 }),
        page
          .getByRole("button", { name: /view cart/i })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 }),
        page.waitForURL(/\/cart(?:[/?#]|$)/, { timeout: 20_000 }),
      ]).catch(() => {
        throw new Error("Target did not confirm that the item was added.");
      });
    }
  } finally {
    if (!page.isClosed()) await page.close();
    await session.close();
  }
}

async function main(): Promise<void> {
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
    await addTargetItemToCart(action.productUrl);
    await addIssueComment(
      repository,
      issueNumber,
      "Outbound action completed: one Target item was added to the shopping cart. No checkout or purchase was attempted.",
    );
    await closeIssue(repository, issueNumber);
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
