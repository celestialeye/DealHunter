import { expect, test } from "@playwright/test";

test("dashboard metrics navigate to their detail views", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("metric-projects")).toHaveAttribute(
    "href",
    "/projects",
  );
  await expect(page.getByTestId("metric-listings")).toHaveAttribute(
    "href",
    /view=listings/,
  );
  await expect(page.getByTestId("metric-alerts")).toHaveAttribute(
    "href",
    "/alerts",
  );
  await expect(page.getByTestId("metric-purchases")).toHaveAttribute(
    "href",
    "/purchases",
  );
  await page.getByTestId("metric-alerts").click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
});

test("shows correct seeded availability, price, link, and availability-only rule", async ({
  page,
}) => {
  await page.goto(
    "/projects/pokemon-30th-celebration?view=listings",
  );
  const listingRow = page
    .getByRole("row")
    .filter({ hasText: "Pokémon Center Elite Trainer Box" })
    .first();
  await expect(listingRow).toContainText("Unavailable");
  await expect(listingRow).toContainText("$59.99");
  await expect(
    listingRow.getByRole("link", {
      name: /Open Pokémon Center Elite Trainer Box/,
    }),
  ).toHaveAttribute("href", /pokemoncenter\.com/);
  const boosterRow = page
    .getByRole("row")
    .filter({ hasText: "Booster Bundle — six packs" })
    .filter({ hasText: "Pokémon Center" });
  await expect(boosterRow).toContainText("Unavailable");
  await expect(boosterRow).toContainText("$26.94");
  await expect(boosterRow).toContainText("Known price · not live");

  await page.getByTestId("project-tab-rules").click();
  await expect(
    page.getByText("Alert as soon as a product becomes available"),
  ).toBeVisible();
  await expect(page.getByText(/no price ceiling/i).first()).toBeVisible();
});

test("creates and monitors a deal hunt end to end", async ({ page }) => {
  const suffix = Date.now().toString();
  const projectName = `E2E Collector Hunt ${suffix}`;
  const productName = `E2E Booster Bundle ${suffix}`;
  const ruleName = `E2E Deal Rule ${suffix}`;
  const updatedRuleName = `${ruleName} Updated`;
  const discordName = `E2E Discord ${suffix}`;

  await page.goto("/projects");
  await page.getByTestId("project-name").fill(projectName);
  await page
    .getByTestId("project-description")
    .fill("Validate the complete monitoring and alert workflow.");
  await page.getByTestId("create-project").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectUrl = page.url();

  await page.getByTestId("project-tab-schedule").click();
  await page.getByTestId("project-schedule-mode").selectOption("FIXED");
  await page.getByTestId("project-fixed-seconds").fill("90");
  await page.getByTestId("save-project-schedule").click();
  await expect(page.getByTestId("project-schedule-mode")).toHaveValue("FIXED");
  await expect(page.getByTestId("project-fixed-seconds")).toHaveValue("90");
  await expect(page.locator(".hierarchy-step")).toHaveCount(3);

  await page.getByTestId("project-tab-setup").click();
  await expect(page.getByTestId("url-product-url")).toBeVisible();
  await expect(page.getByText("Add retailer listing")).toHaveCount(0);
  const fixtureUrl = new URL(
    "/api/dev/product-page",
    "http://127.0.0.1:3100",
  );
  fixtureUrl.searchParams.set("name", productName);
  fixtureUrl.searchParams.set("price", "14.99");
  await page.getByTestId("url-product-url").fill(fixtureUrl.toString());
  await page.getByTestId("url-target-quantity").fill("2");
  await page.getByTestId("add-product-from-url").click();
  await expect(page).toHaveURL(/\/products\/[^/]+$/);

  await page.goto(`${projectUrl}?view=listings`);
  await expect(page.getByText(productName).first()).toBeVisible();
  await page.goto(`${projectUrl}?view=rules`);
  await page.getByTestId("rule-name").fill(ruleName);
  await page.getByTestId("rule-max-price").fill("20.00");
  await page.getByTestId("create-rule").click();
  await expect(page.getByText(ruleName).first()).toBeVisible();
  const ruleCard = page.getByTestId("rule-card").filter({ hasText: ruleName });
  await ruleCard.locator("summary").click();
  await ruleCard.getByTestId("edit-rule-name").fill(updatedRuleName);
  await ruleCard.getByTestId("save-rule").click();
  await expect(page.getByText(updatedRuleName).first()).toBeVisible();

  await page.goto("/settings");
  await page.getByTestId("discord-name").fill(discordName);
  await page
    .getByTestId("discord-webhook")
    .fill("http://127.0.0.1:3100/api/dev/discord-webhook");
  await page.getByTestId("save-discord").click();
  await expect(page.getByText(discordName).first()).toBeVisible();
  await page.getByTestId("send-discord-test").click();
  await expect(page.getByTestId("delivery-row").first()).toContainText(
    "Delivered",
  );
  await expect(page.getByTestId("discord-captures")).toContainText(
    "DealHunter connection verified",
  );

  await page.goto(projectUrl);
  for (let index = 0; index < 12; index += 1) {
    await page.getByTestId("run-project-scan").click();
  }
  await page.getByTestId("project-tab-runs").click();
  await expect(page.getByTestId("monitoring-log")).toContainText(productName);
  await expect(page.getByTestId("monitoring-log")).toContainText(
    "Safe local simulation",
  );
  await expect(page.getByTestId("monitoring-log")).toContainText("$14.99");
  await page
    .getByTestId("run-filter-retailer")
    .selectOption("Local Test Retailer");
  await page.getByTestId("run-filter-status").selectOption("SUCCESS");
  await page.getByTestId("run-page-size").selectOption("10");
  await page.getByTestId("apply-run-filters").click();
  await expect(page).toHaveURL(/runRetailer=Local\+Test\+Retailer/);
  await expect(page.getByTestId("run-row")).toHaveCount(10);
  await expect(page.getByRole("link", { name: "Next" })).toBeVisible();

  await page.goto(`${projectUrl}?view=products`);
  await page
    .getByRole("link", { name: `View details for ${productName}` })
    .click();
  await expect(page.getByTestId("product-monitoring-timeline")).toBeVisible();
  await page
    .getByTestId("timeline-filter-retailer")
    .selectOption("Local Test Retailer");
  await page.getByTestId("timeline-filter-status").selectOption("SUCCESS");
  await page.getByTestId("timeline-page-size").selectOption("10");
  await page.getByTestId("apply-timeline-filters").click();
  await expect(page.getByTestId("timeline-row")).toHaveCount(10);
  await expect(page.getByRole("link", { name: "Next" })).toBeVisible();

  await page.goto("/alerts");
  const matchingAlerts = page
    .getByTestId("alert-row")
    .filter({ hasText: productName });
  await expect(matchingAlerts).toHaveCount(1);
  await expect(matchingAlerts.first()).toContainText("Local Test Retailer");

  await page.goto("/purchases");
  await expect(page.getByText("No purchase intents")).toBeVisible();
  await expect(
    page.getByText("Purchase automation is separate from alert rules"),
  ).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByTestId("delivery-row").first()).toContainText(
    "Delivered",
  );
  await expect(page.getByTestId("discord-captures")).toContainText(productName);

  await page.goto(`${projectUrl}?view=rules`);
  const updatedRuleCard = page
    .getByTestId("rule-card")
    .filter({ hasText: updatedRuleName });
  await updatedRuleCard.locator("summary").click();
  await updatedRuleCard.getByTestId("delete-rule").click();
  await expect(
    page.getByTestId("rule-card").filter({ hasText: updatedRuleName }),
  ).toHaveCount(0);
});

test("adds a crawled product by URL and manages retailer records", async ({
  page,
}) => {
  const suffix = Date.now().toString();
  const projectName = `URL Catalog Hunt ${suffix}`;
  const productName = `Crawled Collector Box ${suffix}`;
  const customRetailer = `Custom Cards ${suffix}`;
  const renamedRetailer = `Custom Cards Updated ${suffix}`;

  await page.goto("/projects");
  await page.getByTestId("project-name").fill(projectName);
  await page
    .getByTestId("project-description")
    .fill("Validate URL ingestion and product enrichment.");
  await page.getByTestId("create-project").click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectUrl = page.url();

  await page.getByTestId("project-tab-setup").click();
  const fixtureUrl = new URL(
    "/api/dev/product-page",
    "http://127.0.0.1:3100",
  );
  fixtureUrl.searchParams.set("name", productName);
  fixtureUrl.searchParams.set("price", "24.99");
  await page.getByTestId("url-product-url").fill(fixtureUrl.toString());
  await page.getByTestId("url-target-quantity").fill("2");
  await page.getByTestId("add-product-from-url").click();

  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  await expect(page.getByTestId("product-image")).toBeVisible();
  await expect(page.getByText("Local Test Retailer").first()).toBeVisible();
  await expect(page.getByText("$24.99").first()).toBeVisible();
  await expect(page.getByText(/v1 · GENERIC JSONLD/)).toBeVisible();
  await expect(page.getByTestId("learning-run-row")).toHaveCount(1);
  await page.getByTestId("relearn-listing").click();
  await expect(page.getByText(/v2 · GENERIC JSONLD/)).toBeVisible();
  await expect(page.getByTestId("learning-run-row")).toHaveCount(2);
  await expect(page.getByTestId("product-monitoring-timeline")).toContainText(
    "Product created from URL",
  );
  await page.locator(".schedule-editor summary").first().click();
  await page.getByTestId("schedule-mode").selectOption("BOUNDED");
  await page.getByTestId("schedule-minimum").fill("120");
  await page.getByTestId("schedule-maximum").fill("240");
  await page.getByTestId("save-schedule").click();
  await expect(page.getByText(/BOUNDED/).first()).toBeVisible();

  await page.goto(`${projectUrl}?view=products`);
  await expect(
    page.getByRole("link", { name: `View details for ${productName}` }),
  ).toBeVisible();

  await page.goto("/retailers");
  await expect(page.getByTestId("retailer-row")).not.toHaveCount(0);
  await expect(page.getByTestId("edit-retailer-name")).toHaveCount(0);
  await page.goto("/retailers?new=1");
  await expect(page.getByText("Pokémon Center").first()).toBeVisible();
  await page.getByTestId("new-retailer-name").fill(customRetailer);
  await page
    .getByTestId("new-retailer-domains")
    .fill(`shop-${suffix}.example.com`);
  await page
    .getByTestId("new-retailer-image-domains")
    .fill(`cdn-${suffix}.example.com`);
  await page.getByTestId("create-retailer").click();

  const customRow = page
    .getByTestId("retailer-row")
    .filter({ hasText: customRetailer });
  await expect(customRow).toBeVisible();
  await customRow.getByTestId("edit-retailer").click();
  await page.getByTestId("edit-retailer-name").fill(renamedRetailer);
  await page.getByTestId("save-retailer").click();

  const renamedRow = page
    .getByTestId("retailer-row")
    .filter({ hasText: renamedRetailer });
  await expect(renamedRow).toBeVisible();
  await page.getByTestId("delete-retailer").click();
  await expect(
    page.getByTestId("retailer-row").filter({ hasText: renamedRetailer }),
  ).toHaveCount(0);

  await page.goto("/settings");
  await page
    .getByTestId("dom-learning-model")
    .selectOption("gpt-5.4-mini");
  await page
    .getByTestId("visual-learning-model")
    .selectOption("gpt-5-mini");
  await page.getByTestId("learning-effort").selectOption("medium");
  await page.getByTestId("screening-engine").selectOption("AUTO");
  await page.getByTestId("save-learning-models").click();
  await page.reload();
  await expect(page.getByTestId("dom-learning-model")).toHaveValue(
    "gpt-5.4-mini",
  );
  await expect(page.getByTestId("learning-effort")).toHaveValue("medium");
  await expect(page.getByTestId("screening-engine")).toHaveValue("AUTO");
});
