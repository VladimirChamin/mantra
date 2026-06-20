import { NextResponse } from "next/server";

const LANDING = "http://localhost:3001";

export function middleware(request) {
  const token = request.cookies.get("token")?.value
    || request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.redirect(`${LANDING}/login`);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|api/auth).*)"],
};
