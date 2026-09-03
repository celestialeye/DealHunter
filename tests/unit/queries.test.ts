import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "../../src/lib/db";
import { getProject } from "../../src/lib/queries";

describe("getProject", () => {
  const dataDirectory = mkdtempSync(
    path.join(tmpdir(), "dealhunter-project-query-"),
  );
  const previousDataDirectory = process.env.DEALHUNTER_DATA_DIR;

  beforeAll(() => {
    process.env.DEALHUNTER_DATA_DIR = dataDirectory;
  });

  afterAll(() => {
    globalThis.dealHunterDatabase?.close();
    globalThis.dealHunterDatabase = undefined;
    if (previousDataDirectory === undefined) {
      delete process.env.DEALHUNTER_DATA_DIR;
    } else {
      process.env.DEALHUNTER_DATA_DIR = previousDataDirectory;
    }
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  it("returns the complete monitoring run count beyond the log preview limit", () => {
    const database = getDatabase();
    const insertRun = database.prepare(
      `INSERT INTO monitoring_runs
       (id, listing_id, started_at, status, detail)
       VALUES (?, 'pokemon-listing-1', ?, 'SUCCESS', '')`,
    );

    for (let index = 0; index < 101; index += 1) {
      insertRun.run(
        `query-count-run-${index}`,
        new Date(index * 1000).toISOString(),
      );
    }

    const data = getProject("pokemon-30th-celebration");

    expect(data?.project.monitoring_run_count).toBe(101);
  });

  it("records the enabled-by-default product cart approval timestamp", () => {
    const database = getDatabase();
    const createdAt = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO products
         (id, project_id, canonical_name, created_at)
         VALUES ('default-cart-product', 'pokemon-30th-celebration',
           'Default cart product', ?)`,
      )
      .run(createdAt);

    expect(
      database
        .prepare(
          `SELECT auto_add_to_cart, auto_add_terms_version,
            auto_add_enabled_at
           FROM products WHERE id = 'default-cart-product'`,
        )
        .get(),
    ).toEqual({
      auto_add_to_cart: 1,
      auto_add_terms_version: "2026-09-01",
      auto_add_enabled_at: createdAt,
    });
  });
});
