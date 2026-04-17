import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified: boolean;
}

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || `https://${process.env.VERCEL_URL}` || "http://localhost:3000";
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${baseUrl}/login?error=google_cancelled`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${baseUrl}/login?error=google_not_configured`);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokens: GoogleTokenResponse = await tokenRes.json();

    if (tokens.error || !tokens.access_token) {
      console.error("Google token exchange error:", tokens.error_description);
      return NextResponse.redirect(`${baseUrl}/login?error=google_token_failed`);
    }

    // Get user info
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser: GoogleUserInfo = await userInfoRes.json();

    if (!googleUser.email || !googleUser.email_verified) {
      return NextResponse.redirect(`${baseUrl}/login?error=google_email_unverified`);
    }

    const email = googleUser.email.toLowerCase();
    const domain = email.split("@")[1];

    // Find or create user
    let user = await db.user.findUnique({
      where: { email },
      include: { organization: true },
    });

    let orgId: string;
    let role: string;

    if (user) {
      // Existing user — just update lastActiveAt
      await db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
      orgId = user.organizationId!;
      role = user.role;
    } else {
      // New user via Google — apply same domain-based org logic as signup
      const matchingOrg = await db.organization.findFirst({
        where: { allowedDomains: { has: domain } },
      });

      const result = await db.$transaction(async (tx) => {
        if (matchingOrg) {
          const newUser = await tx.user.create({
            data: {
              email,
              name: googleUser.name,
              image: googleUser.picture,
              role: "member",
              organizationId: matchingOrg.id,
              lastActiveAt: new Date(),
            },
          });
          return { user: newUser, org: matchingOrg };
        } else {
          const org = await tx.organization.create({
            data: { name: "My Organization" },
          });
          const newUser = await tx.user.create({
            data: {
              email,
              name: googleUser.name,
              image: googleUser.picture,
              role: "admin",
              organizationId: org.id,
              lastActiveAt: new Date(),
            },
          });
          return { user: newUser, org };
        }
      });

      user = { ...result.user, organization: result.org };
      orgId = result.org.id;
      role = result.user.role;
    }

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, orgId, role },
      process.env.NEXTAUTH_SECRET || "fallback-secret",
      { expiresIn: "30d" }
    );

    const destination = user.onboarded ? "/dashboard" : "/welcome";
    const response = NextResponse.redirect(`${baseUrl}${destination}`);

    response.cookies.set("hm-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(`${baseUrl}/login?error=google_failed`);
  }
}
