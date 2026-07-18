# Multi-Tenant Enterprise Communication Platform

This platform now supports strict multi-tenant request scoping on top of the communication stack.

## Architecture

```text
                        +-------------------------------+
                        |        Global Super Admin     |
                        | tenant ops, billing, health   |
                        +---------------+---------------+
                                        |
                                        v
+--------------------+      +-----------+------------+      +----------------------+
| Web / Mobile / SDK | ---> | Node.js API Monolith   | ---> | Root PostgreSQL DB   |
| with X-Tenant-Slug |      | auth + tenant context  |      | orgs, sessions,      |
| + API Key / JWT    |      | RBAC + audit + billing |      | tenant configs       |
+--------------------+      +-----------+------------+      +----------------------+
                                        |
                      +-----------------+------------------+
                      |                                    |
                      v                                    v
           +----------+----------+              +----------+----------+
           | Shared Tenant Data  |              | Optional Dedicated  |
           | org_id isolated     |              | Tenant DB runtime   |
           | users, calls, logs  |              | per organization    |
           +----------+----------+              +----------+----------+
                      |                                    |
                      +-----------------+------------------+
                                        |
                                        v
                             +----------+----------+
                             | LiveKit / Telephony |
                             | comm sessions, API  |
                             +---------------------+
```

## Isolation Model

- Default mode: shared PostgreSQL with strict `organizationId` scoping.
- Optional mode: dedicated tenant database config through `tenant_databases`.
- Session tokens are tenant-bound using `organizationId` and `tenantSlug`.
- Tenant mismatch is rejected from:
  - `Authorization` session usage
  - `X-Tenant-Slug` / `X-Tenant-Id` header mismatches
  - tenant-targeted OTP and password logins

## Core Tables

Root DB:
- `organizations`
- `user_sessions`
- `tenant_databases`
- `tenant_security_policies`
- `audit_logs`

Tenant-scoped data:
- `users`
- `org_members`
- `subscriptions`
- `communication_sessions`
- `communication_session_events`
- other existing call/billing tables with `organizationId`

## Request Conventions

Tenant-aware login:

```http
POST /api/auth/login
X-Tenant-Slug: rapido-demo
Content-Type: application/json

{
  "username": "ops_admin",
  "password": "secret123",
  "tenantSlug": "rapido-demo"
}
```

Tenant workspace APIs:
- `GET /api/tenant/context`
- `GET /api/tenant/workspace/summary`

Super admin tenant control APIs:
- `GET /api/admin/tenants`
- `GET /api/admin/tenants/:organizationId`
- `PUT /api/admin/tenants/:organizationId/database`
- `PUT /api/admin/tenants/:organizationId/security-policy`
- `POST /api/admin/tenants/:organizationId/health-check`

Audit APIs:
- `GET /api/admin/audit-logs`
- `GET /api/admin/audit-logs/export?format=json|csv`
- `GET /api/admin/audit-logs/summary`

## RBAC Model

Platform roles:
- `super_admin`
- `company_admin`
- `agent`
- `consumer`
- `investor`

Tenant member roles:
- `owner`
- `admin`
- `manager`
- `member`

Permission enforcement now supports:
- `users:view`
- `users:assign_roles`
- `org:view_settings`
- `security:view_audit`
- and the rest of `PERMISSIONS` from `shared/schema.ts`

## Deployment Notes

Recommended region:
- `ap-south-1` / Mumbai

Minimum runtime requirements:
- PostgreSQL
- Node.js runtime for API
- LiveKit for WebRTC transport
- provider credentials already documented in `.env.example`

No new mandatory env vars were introduced for tenant isolation. Tenant DB mode and tenant security policy are stored in the database and managed through admin APIs.

Recommended production rollout:
1. Run schema migration / `db push` so `tenant_databases`, `tenant_security_policies`, new `audit_logs.organization_id`, and new `user_sessions` fields exist.
2. Deploy API in Mumbai region.
3. Seed or create tenant companies.
4. Call `PUT /api/admin/tenants/:organizationId/security-policy` to enable the policy set you want.
5. Update your web/mobile clients to send `X-Tenant-Slug` on company workspace requests.
6. Run `POST /api/admin/tenants/:organizationId/health-check` for each dedicated DB tenant.

## Validation Checklist

- Tenant-bound session reuse across companies should return `403`.
- Company admins should only see audit logs for their own organization.
- Role management routes now require explicit RBAC permissions.
- Tenant summary endpoints reject cross-tenant access.
- Super admin can inspect tenant DB mode, health, and security policy centrally.
