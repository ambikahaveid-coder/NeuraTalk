import { Request, Response, Router } from "express";
import { db } from "./db";
import { users, orgMembers, customRoles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "./role-middleware";
import multer from "multer";

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

interface ImportUser {
  username: string;
  email?: string;
  phone?: string;
  role?: string;
  customRoleName?: string;
}

interface ImportResult {
  success: boolean;
  row: number;
  username: string;
  error?: string;
  userId?: number;
}

function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

router.get("/api/organization/import/template", requireRole("company_admin", "super_admin"), async (_req: Request, res: Response) => {
  const csvContent = `username,email,phone,role,customRoleName
john.doe,john.doe@company.com,+1234567890,agent,
jane.smith,jane.smith@company.com,+1987654321,agent,Sales Team
bob.wilson,bob.wilson@company.com,,consumer,`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=user_import_template.csv');
  res.send(csvContent);
});

router.post("/api/organization/import/validate", requireRole("company_admin", "super_admin"), upload.single('file'), async (req: MulterRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const content = req.file.buffer.toString('utf-8');
    const rows = parseCSV(content);

    if (rows.length < 2) {
      return res.status(400).json({ error: "CSV must have at least a header row and one data row" });
    }

    const headers = rows[0].map(h => h.toLowerCase());
    const usernameIdx = headers.indexOf('username');
    const emailIdx = headers.indexOf('email');
    const phoneIdx = headers.indexOf('phone');
    const roleIdx = headers.indexOf('role');
    const customRoleIdx = headers.indexOf('customrolename');

    if (usernameIdx === -1) {
      return res.status(400).json({ error: "CSV must have a 'username' column" });
    }

    const validationResults: { row: number; username: string; valid: boolean; errors: string[] }[] = [];
    const usersToImport: ImportUser[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const username = row[usernameIdx] || '';
      const errors: string[] = [];

      if (!username) {
        errors.push("Username is required");
      }

      const email = emailIdx !== -1 ? row[emailIdx] : undefined;
      const phone = phoneIdx !== -1 ? row[phoneIdx] : undefined;
      const role = roleIdx !== -1 ? row[roleIdx] : 'agent';

      if (!email && !phone) {
        errors.push("Either email or phone is required");
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push("Invalid email format");
      }

      const validRoles = ['agent', 'consumer', 'company_admin'];
      if (role && !validRoles.includes(role)) {
        errors.push(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
      }

      validationResults.push({
        row: i + 1,
        username,
        valid: errors.length === 0,
        errors
      });

      if (errors.length === 0) {
        usersToImport.push({
          username,
          email: email || undefined,
          phone: phone || undefined,
          role: role || 'agent',
          customRoleName: customRoleIdx !== -1 ? row[customRoleIdx] : undefined
        });
      }
    }

    res.json({
      totalRows: rows.length - 1,
      validRows: validationResults.filter(r => r.valid).length,
      invalidRows: validationResults.filter(r => !r.valid).length,
      validationResults,
      usersToImport
    });
  } catch (error) {
    console.error("Error validating CSV:", error);
    res.status(500).json({ error: "Failed to validate CSV" });
  }
});

router.post("/api/organization/import/execute", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const { usersToImport } = req.body;

    if (!usersToImport || !Array.isArray(usersToImport) || usersToImport.length === 0) {
      return res.status(400).json({ error: "No users to import" });
    }

    const orgId = organizationId || req.body.organizationId;
    const results: ImportResult[] = [];

    let customRolesMap: Record<string, number> = {};
    const roleNames = Array.from(new Set(usersToImport.map((u: ImportUser) => u.customRoleName).filter(Boolean)));
    
    if (roleNames.length > 0) {
      const roles = await db.select()
        .from(customRoles)
        .where(eq(customRoles.organizationId, orgId));
      
      customRolesMap = roles.reduce((acc, role) => {
        acc[role.name.toLowerCase()] = role.id;
        return acc;
      }, {} as Record<string, number>);
    }

    for (let i = 0; i < usersToImport.length; i++) {
      const userData = usersToImport[i];
      
      try {
        const [existingUser] = await db.select().from(users)
          .where(eq(users.username, userData.username));

        if (existingUser) {
          results.push({
            success: false,
            row: i + 1,
            username: userData.username,
            error: "Username already exists"
          });
          continue;
        }

        const [newUser] = await db.insert(users).values({
          username: userData.username,
          email: userData.email || null,
          phone: userData.phone || null,
          role: userData.role || 'agent',
          organizationId: orgId,
          isActive: true,
        }).returning();

        await db.insert(orgMembers).values({
          userId: newUser.id,
          organizationId: orgId,
          memberRole: userData.role === 'company_admin' ? 'admin' : 'member',
          permissions: [],
        });

        if (userData.customRoleName) {
          const roleId = customRolesMap[userData.customRoleName.toLowerCase()];
          if (roleId) {
            const [role] = await db.select()
              .from(customRoles)
              .where(eq(customRoles.id, roleId));
            
            if (role) {
              await db.update(orgMembers)
                .set({ permissions: role.permissions })
                .where(eq(orgMembers.userId, newUser.id));
            }
          }
        }

        results.push({
          success: true,
          row: i + 1,
          username: userData.username,
          userId: newUser.id
        });
      } catch (error: any) {
        results.push({
          success: false,
          row: i + 1,
          username: userData.username,
          error: error.message || "Failed to create user"
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Imported ${successCount} users, ${failCount} failed`,
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failCount
      }
    });
  } catch (error) {
    console.error("Error importing users:", error);
    res.status(500).json({ error: "Failed to import users" });
  }
});

export default router;
