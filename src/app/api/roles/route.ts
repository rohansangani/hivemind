import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { currentUserHasPermission } from "@/lib/authz";
import { ROLE_DEFAULT_PERMISSIONS, KB_TAB_PERMISSIONS, MODULES } from "@/lib/modules";

const BUILT_IN_ROLES = [
  { slug: "owner", name: "Owner", description: "Full control including org settings and billing", color: "#7C3AED", rank: 4 },
  { slug: "admin", name: "Admin", description: "Manage team, settings, and all content operations", color: "#4361EE", rank: 3 },
  { slug: "marketing", name: "Marketing", description: "Content creation, knowledge base, AI tools, design briefs", color: "#059669", rank: 2 },
  { slug: "sales", name: "Sales", description: "Browse assets, ask Halo, view industry insights", color: "#F59E0B", rank: 1 },
  { slug: "others", name: "Others", description: "Browse assets, ask Halo, view industry insights", color: "#6B7280", rank: 1 },
];

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };

    const customRoles = await db.customRole.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: [{ rank: "desc" }, { name: "asc" }],
    });

    const builtIn = BUILT_IN_ROLES.map(r => {
      const existing = customRoles.find(c => c.slug === r.slug && c.isBuiltIn);
      return {
        id: existing?.id || r.slug,
        slug: r.slug,
        name: existing?.name || r.name,
        description: existing?.description || r.description,
        color: existing?.color || r.color,
        rank: r.rank,
        isBuiltIn: true,
        permissions: existing?.permissions || ROLE_DEFAULT_PERMISSIONS[r.slug] || {},
        kbPermissions: existing?.kbPermissions || KB_TAB_PERMISSIONS[r.slug] || {},
      };
    });

    const custom = customRoles
      .filter(c => !c.isBuiltIn)
      .map(c => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        color: c.color,
        rank: c.rank,
        isBuiltIn: false,
        permissions: c.permissions,
        kbPermissions: c.kbPermissions,
      }));

    return NextResponse.json({
      roles: [...builtIn, ...custom],
      modules: MODULES,
    });
  } catch (error) {
    console.error("Roles GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
    if (!(await currentUserHasPermission(decoded.userId, "manage_settings"))) {
      return NextResponse.json({ error: "Only admins can manage roles" }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const { name, description, color, permissions, kbPermissions } = body;
      if (!name?.trim()) return NextResponse.json({ error: "Role name is required" }, { status: 400 });
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!slug) return NextResponse.json({ error: "Invalid role name" }, { status: 400 });

      const reserved = ["owner", "admin", "marketing", "sales", "others", "editor", "member", "viewer"];
      if (reserved.includes(slug)) return NextResponse.json({ error: "This role name is reserved" }, { status: 400 });

      const existing = await db.customRole.findUnique({ where: { organizationId_slug: { organizationId: decoded.orgId, slug } } });
      if (existing) return NextResponse.json({ error: "A role with this name already exists" }, { status: 409 });

      const role = await db.customRole.create({
        data: {
          name: name.trim(),
          slug,
          description: description || null,
          color: color || "#6B7280",
          rank: 1,
          permissions: permissions || {},
          kbPermissions: kbPermissions || {},
          isBuiltIn: false,
          organizationId: decoded.orgId,
        },
      });

      return NextResponse.json({ role, success: true }, { status: 201 });
    }

    if (action === "update") {
      const { slug, permissions, kbPermissions, name, description, color } = body;
      if (!slug) return NextResponse.json({ error: "Role slug is required" }, { status: 400 });

      const builtInSlugs = BUILT_IN_ROLES.map(r => r.slug);
      const isBuiltIn = builtInSlugs.includes(slug);

      if (isBuiltIn && (slug === "owner")) {
        return NextResponse.json({ error: "Owner role cannot be modified" }, { status: 403 });
      }

      const existing = await db.customRole.findUnique({
        where: { organizationId_slug: { organizationId: decoded.orgId, slug } },
      });

      if (existing) {
        const updateData: Record<string, unknown> = {};
        if (permissions !== undefined) updateData.permissions = permissions;
        if (kbPermissions !== undefined) updateData.kbPermissions = kbPermissions;
        if (!isBuiltIn && name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (!isBuiltIn && color !== undefined) updateData.color = color;

        await db.customRole.update({ where: { id: existing.id }, data: updateData });
      } else if (isBuiltIn) {
        const builtInDef = BUILT_IN_ROLES.find(r => r.slug === slug)!;
        await db.customRole.create({
          data: {
            name: builtInDef.name,
            slug,
            description: description ?? builtInDef.description,
            color: builtInDef.color,
            rank: builtInDef.rank,
            permissions: permissions ?? ROLE_DEFAULT_PERMISSIONS[slug] ?? {},
            kbPermissions: kbPermissions ?? KB_TAB_PERMISSIONS[slug] ?? {},
            isBuiltIn: true,
            organizationId: decoded.orgId,
          },
        });
      } else {
        return NextResponse.json({ error: "Role not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      const { slug } = body;
      if (!slug) return NextResponse.json({ error: "Role slug is required" }, { status: 400 });
      const builtInSlugs = BUILT_IN_ROLES.map(r => r.slug);
      if (builtInSlugs.includes(slug)) return NextResponse.json({ error: "Cannot delete built-in roles" }, { status: 403 });

      const role = await db.customRole.findUnique({
        where: { organizationId_slug: { organizationId: decoded.orgId, slug } },
      });
      if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

      const usersWithRole = await db.user.count({ where: { organizationId: decoded.orgId, role: slug } });
      if (usersWithRole > 0) {
        return NextResponse.json({ error: `Cannot delete: ${usersWithRole} user(s) still assigned to this role. Reassign them first.` }, { status: 409 });
      }

      await db.customRole.delete({ where: { id: role.id } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Roles POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
