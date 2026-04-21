import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOGIN_PATH = "/login";
const REGISTER_PATH = "/register";

const IS_DEV = process.env.NODE_ENV === "development";

function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`))
    return true;
  if (pathname === REGISTER_PATH || pathname.startsWith(`${REGISTER_PATH}/`))
    return true;
  return false;
}

/** Copia Set-Cookie e header cache dalla risposta sessione verso redirect (refresh token). */
function applyAuthSideEffects(from: NextResponse, to: NextResponse) {
  const cookies = from.headers.getSetCookie();
  for (const c of cookies) {
    to.headers.append("Set-Cookie", c);
  }
  const cacheCtl = from.headers.get("cache-control");
  const pragma = from.headers.get("pragma");
  const expires = from.headers.get("expires");
  if (cacheCtl) to.headers.set("cache-control", cacheCtl);
  if (pragma) to.headers.set("pragma", pragma);
  if (expires) to.headers.set("expires", expires);
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (IS_DEV) {
      console.warn(
        "[middleware] NEXT_PUBLIC_SUPABASE_URL o chiave anon/publishable assenti → gate auth disattivato"
      );
      response.headers.set("x-ff-auth-env", "missing");
    }
    return response;
  }

  if (IS_DEV) {
    response.headers.set("x-ff-auth-env", "ok");
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value)
          );
        },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (IS_DEV && error) {
      console.warn("[middleware] auth.getUser:", error.message);
    }

    if (IS_DEV) {
      response.headers.set("x-ff-auth-user", user ? "1" : "0");
    }

    const path = request.nextUrl.pathname;

    if (!user && !isPublicPath(path)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = LOGIN_PATH;
      redirectUrl.searchParams.set("next", path);
      const redirectResponse = NextResponse.redirect(redirectUrl);
      applyAuthSideEffects(response, redirectResponse);
      if (IS_DEV) {
        redirectResponse.headers.set("x-ff-auth-env", "ok");
        redirectResponse.headers.set("x-ff-auth-user", "0");
        redirectResponse.headers.set("x-ff-auth-action", "redirect-login");
      }
      return redirectResponse;
    }

    if (user && (path === LOGIN_PATH || path === REGISTER_PATH)) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      const redirectResponse = NextResponse.redirect(home);
      applyAuthSideEffects(response, redirectResponse);
      if (IS_DEV) {
        redirectResponse.headers.set("x-ff-auth-env", "ok");
        redirectResponse.headers.set("x-ff-auth-user", "1");
        redirectResponse.headers.set("x-ff-auth-action", "redirect-home");
      }
      return redirectResponse;
    }

    return response;
  } catch (e) {
    console.error("[middleware]", e);
    return response;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
