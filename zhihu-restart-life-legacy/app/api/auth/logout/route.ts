import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/zhihu-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  logout(request);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.delete("restart_life_zhihu_session");
  return response;
}
