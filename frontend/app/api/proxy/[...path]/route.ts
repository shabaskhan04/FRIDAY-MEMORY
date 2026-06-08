import { type NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.FRIDAY_API_URL ?? process.env.NEXT_PUBLIC_FRIDAY_API_URL ?? "http://localhost:3001";
const API_SECRET  = process.env.FRIDAY_API_SECRET ?? process.env.NEXT_PUBLIC_FRIDAY_API_SECRET ?? "";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

async function proxy(req: NextRequest, params: { path: string[] }) {
  const backendPath = "/" + params.path.join("/");
  const search      = req.nextUrl.search;
  const url         = `${BACKEND_URL}${backendPath}${search}`;

  const headers: Record<string, string> = {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${API_SECRET}`,
  };

  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();

  try {
    const res = await fetch(url, { method: req.method, headers, body });
    const data = await res.text();
    return new NextResponse(data, {
      status:  res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
