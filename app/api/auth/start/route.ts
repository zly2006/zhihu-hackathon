import { NextRequest, NextResponse } from "next/server";
import { applicationUrl, attachSessionCookie, authorizationUrl, recordOAuthError } from "@/lib/zhihu-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const { session, url } = authorizationUrl(request);
    const response = NextResponse.redirect(url);
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    const session = recordOAuthError(request, error);
    const response = NextResponse.redirect(applicationUrl("/?oauth=configuration", request));
    attachSessionCookie(response, session);
    return response;
  }
}
