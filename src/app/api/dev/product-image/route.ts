import { NextResponse } from "next/server";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export function GET() {
  if (process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(pixel, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}
