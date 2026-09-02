import { spawn } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import {
  claimNextCartAction,
  completeCartAction,
  failCartAction,
  getConfiguredChromeProfile,
} from "@/lib/cart-actions";
import { audit, getDatabase } from "@/lib/db";

const executionResultSchema = z.object({
  success: z.literal(true),
  productKey: z.string().min(1),
  baselineProductQuantity: z.number().int().nonnegative(),
  finalProductQuantity: z.number().int().nonnegative(),
  baselineCartUnits: z.number().int().nonnegative(),
  finalCartUnits: z.number().int().nonnegative(),
});

export async function executeCartAction(args: {
  productUrl: string;
  productKey: string;
  retailerId: string;
  profileName: string;
}) {
  const rawResult = await new Promise<string>((resolve, reject) => {
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "cart-ui-executor.ps1",
    );
    const child = spawn(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-ProductUrl",
        args.productUrl,
        "-ProductKey",
        args.productKey,
        "-ExpectedProfileName",
        args.profileName,
        "-RetailerId",
        args.retailerId,
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Cart UI execution timed out."));
    }, 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `Cart UI executor exited with code ${String(code)}.`,
          ),
        );
        return;
      }
      const outputLines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      resolve(outputLines.at(-1) ?? "");
    });
  });
  const result = executionResultSchema.parse(JSON.parse(rawResult));
  if (result.productKey !== args.productKey) {
    throw new Error("Cart executor returned a different product key.");
  }
  return result;
}

export async function runNextCartAction() {
  const database = getDatabase();
  const action = claimNextCartAction(database);
  if (!action) {
    return { processed: 0, succeeded: 0 };
  }
  const profileName = getConfiguredChromeProfile(database);
  if (!profileName) {
    failCartAction(
      database,
      action.id,
      "No Chrome profile is configured for cart automation.",
    );
    return { processed: 1, succeeded: 0 };
  }

  try {
    const result = await executeCartAction({
      productUrl: action.product_url,
      productKey: action.product_key,
      retailerId: action.retailer_id,
      profileName,
    });
    completeCartAction(database, action.id, result);
    audit(
      "cart_action",
      action.id,
      "SUCCEEDED",
      `${action.retailer} cart quantity increased by one for ${action.product_key}; checkout was not attempted.`,
    );
    return { processed: 1, succeeded: 1 };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown cart execution error.";
    failCartAction(database, action.id, message);
    audit("cart_action", action.id, "FAILED", message);
    return { processed: 1, succeeded: 0 };
  }
}
