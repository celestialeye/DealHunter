const SUPPORTED_ACTION_TYPE = "Browser shopping-cart update";

export interface TargetCartAction {
  type: "TARGET_ADD_TO_CART";
  productUrl: string;
  quantity: 1;
}

function readMarkdownField(body: string, field: string): string {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(
    new RegExp(`^\\*\\*${escapedField}:\\*\\*\\s*(.+)$`, "im"),
  );
  const value = match?.[1]?.trim();

  if (!value) {
    throw new Error(`Missing required issue field: ${field}.`);
  }

  return value;
}

export function validateTargetProductUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Product URL is not a valid URL.");
  }

  if (
    url.protocol !== "https:" ||
    !["target.com", "www.target.com"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  ) {
    throw new Error("Product URL must be an HTTPS Target URL.");
  }

  if (!/^\/p\/.+\/-\/A-\d+\/?$/.test(url.pathname)) {
    throw new Error("Product URL must identify a Target product page.");
  }

  return url.toString();
}

export function parseOutboundActionIssue(body: string): TargetCartAction {
  const actionType = readMarkdownField(body, "Action type");
  if (actionType !== SUPPORTED_ACTION_TYPE) {
    throw new Error(`Unsupported outbound action type: ${actionType}.`);
  }

  return {
    type: "TARGET_ADD_TO_CART",
    productUrl: validateTargetProductUrl(
      readMarkdownField(body, "Product URL"),
    ),
    quantity: 1,
  };
}

export function isApprovedOutboundAction(labels: readonly string[]): boolean {
  return labels.includes("approval:approved");
}
