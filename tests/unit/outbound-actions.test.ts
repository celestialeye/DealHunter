import { describe, expect, it } from "vitest";

import {
  extractTargetProductId,
  isApprovedOutboundAction,
  parseOutboundActionIssue,
  validateTargetProductUrl,
} from "../../src/lib/outbound-actions";

const approvedIssueBody = `
## Outbound action approval

**Action type:** Browser shopping-cart update

**Target system:** Target.com

**Product URL:** https://www.target.com/p/example-product/-/A-95113212
`;

describe("parseOutboundActionIssue", () => {
  it("parses the supported Target cart action", () => {
    expect(parseOutboundActionIssue(approvedIssueBody)).toEqual({
      type: "TARGET_ADD_TO_CART",
      productUrl:
        "https://www.target.com/p/example-product/-/A-95113212",
      quantity: 1,
    });
  });

  it("rejects unsupported action types", () => {
    expect(() =>
      parseOutboundActionIssue(
        approvedIssueBody.replace(
          "Browser shopping-cart update",
          "Place an order",
        ),
      ),
    ).toThrow("Unsupported outbound action type");
  });
});

describe("validateTargetProductUrl", () => {
  it("rejects non-Target hosts", () => {
    expect(() =>
      validateTargetProductUrl(
        "https://target.com.example.test/p/example/-/A-95113212",
      ),
    ).toThrow("HTTPS Target URL");
  });

  it("rejects non-product Target URLs", () => {
    expect(() =>
      validateTargetProductUrl("https://www.target.com/cart"),
    ).toThrow("Target product page");
  });

  it("extracts the exact Target product ID", () => {
    expect(
      extractTargetProductId(
        "https://www.target.com/p/example-product/-/A-95113212",
      ),
    ).toBe("A-95113212");
  });
});

describe("isApprovedOutboundAction", () => {
  it("requires the approval label", () => {
    expect(
      isApprovedOutboundAction(["approval:pending", "approval:approved"]),
    ).toBe(true);
    expect(isApprovedOutboundAction(["approval:pending"])).toBe(false);
  });
});
