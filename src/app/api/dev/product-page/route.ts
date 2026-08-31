import { NextResponse } from "next/server";

export function GET(request: Request) {
  if (process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const requestUrl = new URL(request.url);
  const name = requestUrl.searchParams.get("name") ?? "Test Booster Bundle";
  const price = requestUrl.searchParams.get("price") ?? "24.99";
  const image = new URL("/api/dev/product-image", requestUrl).toString();
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description:
      "A crawler fixture representing an authentic retailer product detail page.",
    image: [image],
    sku: "E2E-SKU-001",
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
  return new NextResponse(
    `<!doctype html><html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify(product)}</script></head><body><h1>${name}</h1></body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}
