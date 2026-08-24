import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source) return NextResponse.json({ error: "missing avatar url" }, { status: 400 });
  let avatarUrl: URL;
  try { avatarUrl = new URL(source); }
  catch { return NextResponse.json({ error: "invalid avatar url" }, { status: 400 }); }
  if (avatarUrl.protocol !== "https:" || !(avatarUrl.hostname === "zhimg.com" || avatarUrl.hostname.endsWith(".zhimg.com"))) {
    return NextResponse.json({ error: "avatar host is not allowed" }, { status: 403 });
  }
  try {
    const response = await fetch(avatarUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
        Referer: "https://www.zhihu.com/",
      },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return NextResponse.json({ error: `avatar upstream HTTP ${response.status}` }, { status: 502 });
    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return NextResponse.json({ error: "avatar upstream is not an image" }, { status: 502 });
    return new NextResponse(await response.arrayBuffer(), {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return NextResponse.json({ error: "avatar upstream request failed" }, { status: 502 });
  }
}
