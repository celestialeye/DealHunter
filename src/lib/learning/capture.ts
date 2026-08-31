import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

import { getDataDirectory, getDatabase } from "@/lib/db";
import type {
  LearningBundle,
  LearningContext,
} from "@/lib/learning/types";

const execFileAsync = promisify(execFile);

function safeNetworkUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function challengeSignatures(value: string) {
  const normalized = value.toLowerCase();
  return [
    "pardon our interruption",
    "verify you are human",
    "access denied",
    "_incapsula_resource",
    "hcaptcha",
    "recaptcha",
    "checking your browser",
    "unusual traffic",
  ].filter((signature) => normalized.includes(signature));
}

async function captureWithPlaywright(
  context: LearningContext,
  learningRunId: string,
): Promise<LearningBundle> {
  const artifactDirectory = path.join(
    getDataDirectory(),
    "learning",
    learningRunId,
  );
  mkdirSync(artifactDirectory, { recursive: true });
  const screenshotPath = path.join(artifactDirectory, "screenshot.png");
  let httpStatus: number | null = null;
  let httpSource = "";
  try {
    const response = await fetch(context.productUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "DealHunter/0.1 monitor recipe learner",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    httpStatus = response.status;
    httpSource = (await response.text()).slice(0, 150_000);
    writeFileSync(
      path.join(artifactDirectory, "http-source.html"),
      httpSource,
    );
  } catch (error) {
    writeFileSync(
      path.join(artifactDirectory, "http-error.txt"),
      error instanceof Error ? error.message : "HTTP capture failed.",
    );
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const browserContext = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await browserContext.newPage();
    const networkSummary: LearningBundle["networkSummary"] = [];
    page.on("response", (response) => {
      if (networkSummary.length >= 150) return;
      networkSummary.push({
        status: response.status(),
        resourceType: response.request().resourceType(),
        url: safeNetworkUrl(response.url()),
        contentType: response.headers()["content-type"] ?? null,
      });
    });

    try {
      await page.goto(context.productUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
    } catch (error) {
      writeFileSync(
        path.join(artifactDirectory, "navigation-error.txt"),
        error instanceof Error ? error.message : "Navigation failed.",
      );
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const title = await page.title();
    const visibleText = (await page.locator("body").innerText()).slice(
      0,
      50_000,
    );
    const sanitizedDom = await page.evaluate(() => {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(
          "script, style, noscript, template, input, textarea, select",
        )
        .forEach((element) => element.remove());
      clone
        .querySelectorAll("[contenteditable], [data-token], [data-auth]")
        .forEach((element) => {
          element.removeAttribute("contenteditable");
          element.removeAttribute("data-token");
          element.removeAttribute("data-auth");
        });
      return clone.outerHTML.slice(0, 120_000);
    });
    let accessibilityTree = "";
    try {
      accessibilityTree = (
        await page.locator("body").ariaSnapshot({ timeout: 10_000 })
      ).slice(0, 40_000);
    } catch (error) {
      accessibilityTree = `Accessibility capture failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }
    const combinedChallengeInput = `${title}\n${visibleText}\n${sanitizedDom.slice(
      0,
      20_000,
    )}`;
    const signatures = challengeSignatures(combinedChallengeInput);

    writeFileSync(path.join(artifactDirectory, "dom.html"), sanitizedDom);
    writeFileSync(
      path.join(artifactDirectory, "visible-text.txt"),
      visibleText,
    );
    writeFileSync(
      path.join(artifactDirectory, "accessibility.txt"),
      accessibilityTree,
    );
    writeFileSync(
      path.join(artifactDirectory, "network.json"),
      JSON.stringify(networkSummary, null, 2),
    );

    return {
      screeningEngine: "PLAYWRIGHT",
      artifactDirectory,
      finalUrl: page.url(),
      httpStatus,
      title,
      httpSource,
      sanitizedDom,
      visibleText,
      accessibilityTree,
      networkSummary,
      screenshotPath,
      challengeSignatures: signatures,
    };
  } finally {
    await browser.close();
  }
}

async function captureWithSeleniumBase(
  context: LearningContext,
  learningRunId: string,
): Promise<LearningBundle> {
  const artifactDirectory = path.join(
    getDataDirectory(),
    "learning",
    learningRunId,
  );
  mkdirSync(artifactDirectory, { recursive: true });
  const screenshotPath = path.join(artifactDirectory, "screenshot.png");
  const result = await execFileAsync(
    process.env.DEALHUNTER_PYTHON_PATH ?? "python",
    [
      path.join(process.cwd(), "scripts", "seleniumbase_capture.py"),
      "--url",
      context.productUrl,
      "--artifact-dir",
      artifactDirectory,
    ],
    {
      cwd: process.cwd(),
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const metadata = JSON.parse(result.stdout) as {
    finalUrl: string;
    httpStatus: number | null;
    title: string;
  };
  const rawDom = readFileSync(path.join(artifactDirectory, "dom.html"), "utf8");
  const sanitizedDom = rawDom
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(
      /<(input|textarea|select)[\s\S]*?<\/\1>|<(input)[^>]*>/gi,
      "",
    )
    .slice(0, 120_000);
  const visibleText = readFileSync(
    path.join(artifactDirectory, "visible-text.txt"),
    "utf8",
  ).slice(0, 50_000);
  const httpSourcePath = path.join(artifactDirectory, "http-source.html");
  const httpSource = existsSync(httpSourcePath)
    ? readFileSync(httpSourcePath, "utf8").slice(0, 150_000)
    : "";
  const signatures = challengeSignatures(
    `${metadata.title}\n${visibleText}\n${sanitizedDom.slice(0, 20_000)}`,
  );
  return {
    screeningEngine: "SELENIUMBASE",
    artifactDirectory,
    finalUrl: metadata.finalUrl,
    httpStatus: metadata.httpStatus,
    title: metadata.title,
    httpSource,
    sanitizedDom,
    visibleText,
    accessibilityTree:
      "Accessibility snapshot is not available from the SeleniumBase backend.",
    networkSummary: [],
    screenshotPath,
    challengeSignatures: signatures,
  };
}

export async function captureLearningBundle(
  context: LearningContext,
  learningRunId: string,
) {
  const settings = getDatabase()
    .prepare(
      "SELECT screening_engine FROM learning_settings WHERE id = 'default'",
    )
    .get() as { screening_engine: "PLAYWRIGHT" | "SELENIUMBASE" | "AUTO" };
  const configured =
    process.env.DEALHUNTER_SCREENING_ENGINE ?? settings.screening_engine;
  if (configured === "SELENIUMBASE") {
    return captureWithSeleniumBase(context, learningRunId);
  }
  if (configured === "AUTO") {
    try {
      return await captureWithPlaywright(context, learningRunId);
    } catch (playwrightError) {
      try {
        return await captureWithSeleniumBase(context, learningRunId);
      } catch (seleniumError) {
        throw new Error(
          `Both screening engines failed. Playwright: ${
            playwrightError instanceof Error
              ? playwrightError.message
              : "unknown error"
          }. SeleniumBase: ${
            seleniumError instanceof Error
              ? seleniumError.message
              : "unknown error"
          }.`,
        );
      }
    }
  }
  return captureWithPlaywright(context, learningRunId);
}
