import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const redirectTo = searchParams.get("redirect") || "/";

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host  = request.headers.get("x-forwarded-host") || request.headers.get("host") || "app.mantrade.ru";
  const base  = `${proto}://${host}`;

  if (!token) {
    return NextResponse.redirect(new URL("/", base));
  }

  const response = NextResponse.redirect(new URL(redirectTo, base));
  response.cookies.set("token", token, {
    path: "/",
    maxAge: 7 * 24 * 3600,
    sameSite: "lax",
    httpOnly: false, // нужен доступ из JS для api.js
  });
  return response;
}
