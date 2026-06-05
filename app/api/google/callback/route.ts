import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { saveGoogleTokens } from "@/lib/google-token";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  // User denied access
  if (error) {
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(error)}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: "Missing OAuth code parameter." },
      { status: 400 }
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Google OAuth env vars are not configured on the server." },
      { status: 500 }
    );
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.json(
        {
          error:
            "Token exchange did not return access_token or refresh_token. " +
            "Make sure 'prompt=consent' is set in the auth URL and the app has offline access.",
        },
        { status: 500 }
      );
    }

    await saveGoogleTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    });

    // Redirect back to app with success flag
    return NextResponse.redirect(
      new URL("/?google_connected=1", req.url)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error during token exchange.";
    console.error("[google/callback]", msg);
    return NextResponse.redirect(
      new URL(`/?google_error=${encodeURIComponent(msg)}`, req.url)
    );
  }
}
