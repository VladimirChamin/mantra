import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const redirectTo = searchParams.get("redirect") || "/";

  if (!token) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  response.cookies.set("token", token, {
    path: "/",
    maxAge: 7 * 24 * 3600,
    sameSite: "lax",
    httpOnly: false, // нужен доступ из JS для api.js
  });
  return response;
}
