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
      // Existing user — fix onboarded for non-admin/owner users who were created before the fix
      const shouldOnboard = !user.onboarded && user.role !== "owner" && user.role !== "admin";
      // Google sign-in is a real first sign-in for an invited user too — there's no separate
      // accept-invite flow, so this is where "pending" needs to clear.
      const clearInvite = user.inviteStatus === "pending";
      await db.user.update({
        where: { id: user.id },
        data: {
          lastActiveAt: new Date(),
          ...(shouldOnboard ? { onboarded: true } : {}),
          ...(clearInvite ? { inviteStatus: null } : {}),
        },
      });
      if (shouldOnboard) user = { ...user, onboarded: true };
      if (clearInvite) user = { ...user, inviteStatus: null };
      orgId = user.organizationId!;
      role = user.role;
    } else {
      // New user via Google — apply same domain-based org logic as signup
      let matchingOrg = await db.organization.findFirst({
        where: { allowedDomains: { has: domain } },
      });

      // Fallback: check if an existing user in any org shares this email domain
      if (!matchingOrg) {
        const peerUser = await db.user.findFirst({
          where: { email: { endsWith: "@" + domain } },
          select: { organizationId: true },
        });
        if (peerUser?.organizationId) {
          matchingOrg = await db.organization.findUnique({ where: { id: peerUser.organizationId } });
        }
      }

      let resultUser;
      let resultOrg;

      if (matchingOrg) {
        resultUser = await db.user.create({
          data: {
            email,
            name: googleUser.name,
            image: googleUser.picture,
            role: "others",
            organizationId: matchingOrg.id,
            onboarded: true,
            lastActiveAt: new Date(),
          },
        });
        resultOrg = matchingOrg;
      } else {
        resultOrg = await db.organization.create({
          data: { name: "My Organization" },
        });
        resultUser = await db.user.create({
          data: {
            email,
            name: googleUser.name,
            image: googleUser.picture,
            role: "admin",
            organizationId: resultOrg.id,
            lastActiveAt: new Date(),
          },
        });
      }

      user = { ...resultUser, organization: resultOrg };
      orgId = resultOrg.id;
      role = resultUser.role;
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
