import { NextResponse, type NextRequest } from "next/server";
import { AWARD_REGION_COOKIE, awardRegionFromCountry, normalizeAwardRegion } from "@/lib/award-region";

const REGION_DEFAULT_PATHS = new Set(["/awards", "/books", "/subjects"]);

export function proxy(request: NextRequest) {
  if (!REGION_DEFAULT_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();

  const response = NextResponse.next();
  const currentRegion = request.cookies.get(AWARD_REGION_COOKIE)?.value;

  if (!currentRegion) {
    response.cookies.set(AWARD_REGION_COOKIE, awardRegionFromCountry(request.headers.get("x-vercel-ip-country")), {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
  } else if (currentRegion !== normalizeAwardRegion(currentRegion)) {
    response.cookies.set(AWARD_REGION_COOKIE, normalizeAwardRegion(currentRegion), {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/awards", "/books", "/subjects"],
};
