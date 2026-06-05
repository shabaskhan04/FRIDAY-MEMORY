import { google } from "googleapis";
import { createServiceClient, getFridayUserId } from "@/lib/supabase-server";

export interface GoogleTokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scopes: string[];
  updated_at: string;
}

/**
 * Returns a fully initialised OAuth2Client with valid (auto-refreshed) tokens.
 * Throws if no tokens are stored for this user.
 */
export async function getOAuth2Client() {
  const supabase = createServiceClient();
  const userId = getFridayUserId();

  const { data, error } = await supabase
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Google Workspace is not connected. Visit /api/google/connect to authorise.");
  }

  const tokenRow = data as GoogleTokenRow;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXT_PUBLIC_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date,
  });

  // Refresh proactively if within 5 minutes of expiry
  const expiresInMs = tokenRow.expiry_date - Date.now();
  if (expiresInMs < 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);

    // Persist refreshed tokens
    await supabase
      .from("google_tokens")
      .update({
        access_token: credentials.access_token ?? tokenRow.access_token,
        expiry_date: credentials.expiry_date ?? tokenRow.expiry_date,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return oauth2Client;
}

/**
 * Checks whether the user has valid Google tokens stored.
 * Returns true / false — does not throw.
 */
export async function isGoogleConnected(): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const userId = getFridayUserId();

    const { data, error } = await supabase
      .from("google_tokens")
      .select("user_id, expiry_date, refresh_token")
      .eq("user_id", userId)
      .single();

    if (error || !data) return false;

    // Has a refresh token = can always re-connect even if access token expired
    return Boolean((data as GoogleTokenRow).refresh_token);
  } catch {
    return false;
  }
}

/**
 * Stores (upserts) Google OAuth tokens for the current user.
 */
export async function saveGoogleTokens(params: {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scopes: string[];
}): Promise<void> {
  const supabase = createServiceClient();
  const userId = getFridayUserId();

  const { error } = await supabase.from("google_tokens").upsert(
    {
      user_id: userId,
      access_token: params.access_token,
      refresh_token: params.refresh_token,
      expiry_date: params.expiry_date,
      scopes: params.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(`Failed to save Google tokens: ${error.message}`);
}
