import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";

// Portón GRUESO (corre en Edge, SIN tocar la BD): si no hay cookie de sesión en una ruta
// protegida, /api → 401 y páginas → redirect a /login. La validación REAL (sesión vigente,
// tenant, rol) la hacen los handlers con requireAuth/getAuth. Añade cabeceras de seguridad.

const PUBLIC_PAGES = new Set(["/login", "/register"]);
const PUBLIC_API = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/me",
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api");
  const isPublic = isApi ? PUBLIC_API.has(pathname) : PUBLIC_PAGES.has(pathname);

  let res: NextResponse;
  if (!hasCookie && !isPublic) {
    if (isApi) {
      res = NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    } else {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      res = NextResponse.redirect(url);
    }
  } else if (hasCookie && PUBLIC_PAGES.has(pathname)) {
    // ya autenticado entrando a /login o /register → al home
    const url = req.nextUrl.clone();
    url.pathname = "/";
    res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next();
  }

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
