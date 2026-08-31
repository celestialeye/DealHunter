import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  getDatabase().prepare("SELECT 1").get();
  return NextResponse.json({
    status: "ok",
    mode:
      process.env.DEALHUNTER_LIVE_FETCH === "0"
        ? "simulation"
        : "live-http",
  });
}
