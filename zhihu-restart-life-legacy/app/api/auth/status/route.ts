import { NextRequest, NextResponse } from "next/server";
import { attachSessionCookie, publicStatus } from "@/lib/zhihu-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const { session, created, payload } = publicStatus(request);
  const response = NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  if (created) attachSessionCookie(response, session);
  return response;
}
