import { z } from 'zod';
import { insertUserSchema, insertVoiceProfileSchema, insertOrganizationSchema, users, voiceProfiles, conversations, messages, organizations, USER_ROLES } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({
        username: z.string(),
        password: z.string(),
        tenantSlug: z.string().optional(),
        organizationSlug: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: z.object({ message: z.string() }),
      },
    },
    register: {
      method: 'POST' as const,
      path: '/api/auth/register',
      input: insertUserSchema.extend({
        // Only self-service roles are accepted here. "admin" and "investor"
        // accounts are created through their own authenticated/invite-only
        // endpoints (server/investor-routes.ts, admin secret-login) — this
        // is a public, unauthenticated endpoint, so it must never let a
        // caller assign itself a privileged role via a request body field.
        role: z.enum(["business", "consumer"]).optional(),
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .regex(/[A-Za-z]/, "Password must contain at least one letter")
          .regex(/[0-9]/, "Password must contain at least one number")
          .optional(),
        organizationName: z.string().optional(), // For B2B registration
        tenantSlug: z.string().optional(),
        organizationSlug: z.string().optional(),
      }),
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me',
      responses: {
        200: z.custom<typeof users.$inferSelect & { organization?: typeof organizations.$inferSelect | null }>(),
        401: errorSchemas.unauthorized,
      },
    },
  },
  // Organization management (B2B)
  organizations: {
    list: {
      method: 'GET' as const,
      path: '/api/organizations',
      responses: {
        200: z.array(z.custom<typeof organizations.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/organizations/:id',
      responses: {
        200: z.custom<typeof organizations.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/organizations',
      input: insertOrganizationSchema,
      responses: {
        201: z.custom<typeof organizations.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/organizations/:id',
      input: insertOrganizationSchema.partial(),
      responses: {
        200: z.custom<typeof organizations.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    members: {
      method: 'GET' as const,
      path: '/api/organizations/:id/members',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    addMember: {
      method: 'POST' as const,
      path: '/api/organizations/:id/members',
      input: z.object({ userId: z.number(), memberRole: z.string().optional() }),
      responses: {
        201: z.object({ success: z.boolean() }),
      },
    },
  },
  // Role-based user management (Admin only)
  users: {
    list: {
      method: 'GET' as const,
      path: '/api/users',
      responses: {
        200: z.array(z.custom<typeof users.$inferSelect>()),
      },
    },
    updateRole: {
      method: 'PATCH' as const,
      path: '/api/users/:id/role',
      input: z.object({ role: z.enum(["admin", "business", "consumer", "investor"]) }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        403: errorSchemas.unauthorized,
      },
    },
  },
  voiceProfiles: {
    list: {
      method: 'GET' as const,
      path: '/api/voice-profiles',
      responses: {
        200: z.array(z.custom<typeof voiceProfiles.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/voice-profiles',
      input: insertVoiceProfileSchema,
      responses: {
        201: z.custom<typeof voiceProfiles.$inferSelect>(),
      },
    },
  },
  chat: {
    listConversations: {
      method: 'GET' as const,
      path: '/api/conversations',
      responses: { 200: z.array(z.custom<typeof conversations.$inferSelect>()) },
    },
    getConversation: {
      method: 'GET' as const,
      path: '/api/conversations/:id',
      responses: { 200: z.custom<typeof conversations.$inferSelect & { messages: typeof messages.$inferSelect[] }>() },
    },
    createConversation: {
      method: 'POST' as const,
      path: '/api/conversations',
      input: z.object({ title: z.string().optional() }),
      responses: { 201: z.custom<typeof conversations.$inferSelect>() },
    },
    voiceStream: {
      method: 'POST' as const,
      path: '/api/conversations/:id/voice-stream',
      input: z.object({
        audio: z.string(),
        voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).optional(),
        inputFormat: z.enum(["wav", "mp3"]).optional(),
        locale: z.string().optional(),
      }),
      responses: { 200: z.any() },
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
