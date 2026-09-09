import { NextRequest, NextResponse } from "next/server";
import {
  applicationUrl,
  attachSessionCookie,
  completeAuthorization,
  recordOAuthError,
} from "@/lib/zhihu-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await completeAuthorization(request);
    const response = NextResponse.redirect(applicationUrl("/?oauth=success", request));
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    const session = recordOAuthError(request, error);
    const response = NextResponse.redirect(applicationUrl("/?oauth=error", request));
    attachSessionCookie(response, session);
    return response;
  }
}
