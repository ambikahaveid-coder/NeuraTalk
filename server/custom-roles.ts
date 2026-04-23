import { Request, Response, Router } from "express";
import { db } from "./db";
import { customRoles, orgMembers, users, PERMISSIONS } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { loadUser, requireAuth, requirePermission } from "./role-middleware";
import { z } from "zod";

const router = Router();
router.use(loadUser);

router.get("/api/organization/roles", requireAuth, requirePermission(PERMISSIONS.USERS_VIEW), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const orgId = organizationId || parseInt(req.query.organizationId as string);
    
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }

    const roles = await db.select()
      .from(customRoles)
      .where(eq(customRoles.organizationId, orgId));

    res.json({
      roles,
      availablePermissions: Object.values(PERMISSIONS)
    });
  } catch (error) {
    console.error("Error fetching custom roles:", error);
    res.status(500).json({ error: "Failed to fetch custom roles" });
  }
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  isDefault: z.boolean().default(false),
  priority: z.number().default(0),
});

router.post("/api/organization/roles", requireAuth, requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const orgId = organizationId || req.body.organizationId;
    const { name, description, permissions, isDefault, priority } = parsed.data;

    const validPermissions = Object.values(PERMISSIONS) as string[];
    const invalidPerms = permissions.filter(p => !validPermissions.includes(p));
    if (invalidPerms.length > 0) {
      return res.status(400).json({ 
        error: "Invalid permissions", 
        invalidPermissions: invalidPerms,
        validPermissions 
      });
    }

    if (isDefault) {
      await db.update(customRoles)
        .set({ isDefault: false })
        .where(eq(customRoles.organizationId, orgId));
    }

    const [role] = await db.insert(customRoles).values({
      organizationId: orgId,
      name,
      description,
      permissions,
      isDefault,
      priority,
      createdBy: req.user!.id,
    }).returning();

    res.status(201).json(role);
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "A role with this name already exists" });
    }
    console.error("Error creating custom role:", error);
    res.status(500).json({ error: "Failed to create custom role" });
  }
});

router.patch("/api/organization/roles/:id", requireAuth, requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), async (req: Request, res: Response) => {
  try {
    const roleId = parseInt(req.params.id);
    const organizationId = req.user!.organizationId;

    const [existingRole] = await db.select()
      .from(customRoles)
      .where(eq(customRoles.id, roleId));

    if (!existingRole) {
      return res.status(404).json({ error: "Role not found" });
    }

    if (req.user!.role !== "super_admin" && existingRole.organizationId !== organizationId) {
      return res.status(403).json({ error: "Not authorized to edit this role" });
    }

    const { name, description, permissions, isDefault, priority } = req.body;

    if (permissions) {
      const validPermissions = Object.values(PERMISSIONS) as string[];
      const invalidPerms = permissions.filter((p: string) => !validPermissions.includes(p));
      if (invalidPerms.length > 0) {
        return res.status(400).json({ 
          error: "Invalid permissions", 
          invalidPermissions: invalidPerms
        });
      }
    }

    if (isDefault) {
      await db.update(customRoles)
        .set({ isDefault: false })
        .where(eq(customRoles.organizationId, existingRole.organizationId));
    }

    const [updated] = await db.update(customRoles)
      .set({
        name: name ?? existingRole.name,
        description: description ?? existingRole.description,
        permissions: permissions ?? existingRole.permissions,
        isDefault: isDefault ?? existingRole.isDefault,
        priority: priority ?? existingRole.priority,
        updatedAt: new Date(),
      })
      .where(eq(customRoles.id, roleId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating custom role:", error);
    res.status(500).json({ error: "Failed to update custom role" });
  }
});

router.delete("/api/organization/roles/:id", requireAuth, requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), async (req: Request, res: Response) => {
  try {
    const roleId = parseInt(req.params.id);
    const organizationId = req.user!.organizationId;

    const [existingRole] = await db.select()
      .from(customRoles)
      .where(eq(customRoles.id, roleId));

    if (!existingRole) {
      return res.status(404).json({ error: "Role not found" });
    }

    if (req.user!.role !== "super_admin" && existingRole.organizationId !== organizationId) {
      return res.status(403).json({ error: "Not authorized to delete this role" });
    }

    await db.delete(customRoles).where(eq(customRoles.id, roleId));

    res.json({ success: true, message: "Role deleted" });
  } catch (error) {
    console.error("Error deleting custom role:", error);
    res.status(500).json({ error: "Failed to delete custom role" });
  }
});

router.post("/api/organization/users/:userId/assign-role", requireAuth, requirePermission(PERMISSIONS.USERS_ASSIGN_ROLES), async (req: Request, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const { roleId, permissions } = req.body;
    const organizationId = req.user!.organizationId;

    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId));

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.user!.role === "company_admin") {
      if (targetUser.organizationId !== organizationId) {
        return res.status(403).json({ error: "Cannot assign roles to users from other organizations" });
      }
    }

    let finalPermissions = permissions || [];

    if (roleId) {
      const [role] = await db.select()
        .from(customRoles)
        .where(eq(customRoles.id, roleId));

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      finalPermissions = [...(role.permissions as string[]), ...(permissions || [])];
    }

    const [existingMembership] = await db.select()
      .from(orgMembers)
      .where(and(
        eq(orgMembers.userId, targetUserId),
        eq(orgMembers.organizationId, targetUser.organizationId!)
      ));

    if (existingMembership) {
      await db.update(orgMembers)
        .set({ permissions: finalPermissions })
        .where(eq(orgMembers.id, existingMembership.id));
    } else {
      await db.insert(orgMembers).values({
        userId: targetUserId,
        organizationId: targetUser.organizationId!,
        memberRole: "member",
        permissions: finalPermissions,
      });
    }

    res.json({ 
      success: true, 
      message: "Role assigned successfully",
      permissions: finalPermissions
    });
  } catch (error) {
    console.error("Error assigning role:", error);
    res.status(500).json({ error: "Failed to assign role" });
  }
});

router.get("/api/permissions", requireAuth, requirePermission(PERMISSIONS.USERS_VIEW), async (req: Request, res: Response) => {
  try {
    const permissionsList = Object.entries(PERMISSIONS).map(([key, value]) => ({
      key,
      value,
      category: value.split(':')[0],
      action: value.split(':')[1],
    }));

    const categories = Array.from(new Set(permissionsList.map(p => p.category)));

    res.json({
      permissions: permissionsList,
      categories,
      byCategory: categories.reduce((acc, cat) => {
        acc[cat] = permissionsList.filter(p => p.category === cat);
        return acc;
      }, {} as Record<string, typeof permissionsList>)
    });
  } catch (error) {
    console.error("Error fetching permissions:", error);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

export default router;
