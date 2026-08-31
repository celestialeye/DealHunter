import { NextResponse } from "next/server";

import { createId, getDatabase, nowIso } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (process.env.DEALHUNTER_ALLOW_LOCAL_WEBHOOKS !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const payload = await request.text();
  getDatabase()
    .prepare(
      `INSERT INTO discord_captures (id, payload, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(createId(), payload, nowIso());
  return new NextResponse(null, { status: 204 });
}
