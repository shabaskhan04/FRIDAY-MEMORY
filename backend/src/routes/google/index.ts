import type { FastifyInstance } from "fastify";
import { google } from "googleapis";
import { isGoogleConnected, saveGoogleTokens } from "../../lib/google-token";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/tasks",
];

function buildOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function googleRoutes(app: FastifyInstance): Promise<void> {
  // GET /google/connect → redirects browser to Google consent screen
  app.get("/google/connect", async (_request, reply) => {
    const oauth2Client = buildOAuth2Client();

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",        // force consent so we always get a refresh_token
      include_granted_scopes: true,
    });

    return reply.redirect(url);
  });

  // GET /google/callback — OAuth redirect URI (exempt from auth middleware)
  app.get<{ Querystring: { code?: string; error?: string } }>(
    "/google/callback",
    async (request, reply) => {
      const { code, error: oauthError } = request.query;

      const frontendUrl =
        process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";

      if (oauthError || !code) {
        console.error("[google/callback] OAuth error:", oauthError);
        return reply.redirect(`${frontendUrl}/?google_error=1`);
      }

      try {
        const oauth2Client = buildOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.access_token || !tokens.refresh_token) {
          throw new Error("Missing access_token or refresh_token in response.");
        }

        await saveGoogleTokens({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
          scopes: SCOPES,
        });

        return reply.redirect(`${frontendUrl}/?google_connected=1`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Token exchange failed.";
        console.error("[google/callback] error:", message);
        return reply.redirect(`${frontendUrl}/?google_error=1`);
      }
    }
  );

  // GET /google/status
  app.get("/google/status", async (_request, reply) => {
    try {
      const connected = await isGoogleConnected();
      return reply.send({ connected });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error.";
      console.error("[google/status]", message);
      return reply.send({ connected: false, error: message });
    }
  });
}
