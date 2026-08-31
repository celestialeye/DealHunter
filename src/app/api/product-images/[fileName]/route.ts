import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { getDataDirectory } from "@/lib/db";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;
  const match = fileName.match(/^([a-zA-Z0-9-]+)\.(jpg|png|webp|gif|avif)$/);
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const bytes = readFileSync(
      path.join(getDataDirectory(), "images", fileName),
    );
    return new NextResponse(bytes, {
      headers: {
        "content-type": contentTypes[match[2]],
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
