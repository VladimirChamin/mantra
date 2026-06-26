import { NextResponse } from "next/server";

const LANDING = process.env.NEXT_PUBLIC_LANDING_URL
  ?? (process.env.NODE_ENV === "production" ? "https://mantrade.ru" : "http://localhost:3001");

export function middleware(request) {
  const token = request.cookies.get("token")?.value
    || request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.redirect(`${LANDING}/login`);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.*|manifest.*|robots.*|sitemap.*|auth/callback|api/auth).*)"],
};
