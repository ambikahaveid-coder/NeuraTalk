# ✅ VERIFICATION GUIDE - Confirm Everything Works

**Your system is ready when ALL checks below pass ✅**

---

## PHASE 1: System Setup Verification

### Check 1.1: Node.js & NPM Installed
```bash
node --version
# Expected: v18.x or higher

npm --version
# Expected: v9.x or higher

npm list -g | grep -E "npm|node"
# Expected: Shows globally installed packages
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 1.2: Dependencies Installed
```bash
npm list 2>&1 | head -5

# Expected output:
# neuratalk@1.0.0 /path/to/neuratalk
# ├── express@4.x.x
# ├── postgresql@x.x.x
# └── ...
```

**If FAIL**:
```bash
npm install --legacy-peer-deps
npm audit fix
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 1.3: Database Connection
```bash
npm run db:status

# Or manually:
psql $DATABASE_URL -c "SELECT version();"

# Expected: PostgreSQL version info
# Example:
# PostgreSQL 15.2 on x86_64-pc-linux-gnu...
```

**If FAIL**, check:
```bash
# 1. Verify environment variable
echo $DATABASE_URL

# 2. Verify syntax
# psql://user:password@host:port/database

# 3. Test manually
psql -h neuratalkneon.postgres.neon.tech \
     -U postgres \
     -d neuratalk \
     -c "SELECT 1;"

# 4. Check if IP is whitelisted (Neon dashboard)
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 2: Build Verification

### Check 2.1: TypeScript Compilation
```bash
npm run typecheck

# Expected output:
# Type checking passed
# ✅ 0 errors found
```

**If FAIL**:
```bash
# Show all errors
npm run typecheck 2>&1 | tail -50

# Common fixes:
# 1. Update tsconfig.json paths
# 2. Fix import statements
# 3. Add missing type definitions
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 2.2: Linting
```bash
npm run lint

# Expected:
# ✅ 0 errors, 0 warnings
```

**If FAIL**:
```bash
npm run lint:fix  # Auto-fixes common issues
npm run lint      # Re-check
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 2.3: Build Generation
```bash
npm run build

# Expected output (final lines):
# dist/client: 1.2 MB
# dist/server: 450 KB
# ✅ Build completed successfully
```

**If FAIL**:
```bash
# Clear cache and rebuild
rm -rf dist/
npm run build 2>&1 | tee build.log

# Search for errors
grep -i "error\|fail" build.log | head -10

# Fix errors one by one
# Then retry: npm run build
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 3: Runtime Verification

### Check 3.1: Start Development Server
```bash
# Terminal 1: Start server
npm run dev

# Expected output:
# ✅ Server listening on port 3000
# ✅ Database: Connected
# ✅ Sentry: Initialized
```

**If FAIL**:
```bash
# Kill existing processes
pkill -f "node.*index"
pkill -f "npm.*dev"

# Check logs
npm run dev 2>&1

# Common issues:
# - Port 3000 already in use: lsof -i :3000
# - Database not connected: Check DATABASE_URL
# - Build errors: npm run build
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 3.2: Frontend Loading
```bash
# Terminal 2: Test frontend
curl http://localhost:3000

# Expected: HTML response (NOT error)

# Or open browser
open http://localhost:3000

# Check:
# 1. Page loads without errors
# 2. No red errors in console (F12 → Console)
# 3. Logo visible
# 4. Navigation working
```

**If FAIL**:
```bash
# Check server logs
# Look for: "ERR!" or "500"

# Verify API endpoints
curl http://localhost:3000/api/health

# Expected: { "status": "healthy" }

# If not, database is offline
npm run db:push
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 3.3: API Health
```bash
curl -X GET http://localhost:3000/api/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2024-04-01T10:00:00Z",
#   "uptime": 123.45,
#   "database": "connected"
# }
```

**If FAIL** (404 or 500):
```bash
# 1. Verify server is running
ps aux | grep "node.*index"

# 2. Check server logs for errors
npm run dev 2>&1 | grep -i error

# 3. Restart server
npm run dev

# 4. Verify routes are registered
grep -r "app.get.*health" server/
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 4: Database Verification

### Check 4.1: Tables Exist
```bash
psql $DATABASE_URL -c "
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema='public' 
ORDER BY table_name;"

# Expected output (at least):
# ├── companies
# ├── company_employees
# ├── call_records
# ├── users
# └── ... (other tables)
```

**If FAIL** (no tables):
```bash
# Run migrations
npm run db:push

# If still fails:
npm run db:reset  # ⚠️ DELETES ALL DATA
npm run db:push
npn run db:seed   # Restore test data
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 4.2: Schema Validation
```bash
# Test schema structure
npm run test -- schema

# Or manually:
psql $DATABASE_URL -c "
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name='companies' 
ORDER BY ordinal_position;"

# Expected columns:
# id          | character varying | NO
# name        | character varying | NO
# email       | character varying | NO
# countryCode | character varying | NO
# createdAt   | timestamp         | YES
# ... (others)
```

**If FAIL** (missing columns):
```bash
# Check current schema
npm run db:introspect  # If using Drizzle

# Compare with schema files
cat server/schema/companies.schema.ts

# Update migration if needed
npm run db:push
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 4.3: Data Integrity
```bash
# Test basic CRUD operations
npm run test -- database.crud

# Or manually test:
psql $DATABASE_URL << 'EOF'
BEGIN;
  INSERT INTO companies (id, name, email, country_code) 
  VALUES ('test-123', 'Test Corp', 'test@test.com', 'US');
  
  SELECT * FROM companies WHERE id='test-123';
  
  UPDATE companies SET name='Updated Test' WHERE id='test-123';
  
  DELETE FROM companies WHERE id='test-123';
COMMIT;
EOF

# Expected: All operations succeed
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 5: Feature Verification

### Check 5.1: User Authentication (if implemented)
```bash
# Test login endpoint
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@test.com",
    "password": "password123"
  }'

# Expected responses:
# SUCCESS (200): { "token": "jwt...", "user": {...} }
# FAIL (401): { "error": "Invalid credentials" }
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 5.2: Company Creation (B2B)
```bash
curl -X POST http://localhost:3000/api/b2b/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Test Company",
    "email": "company@test.com",
    "countryCode": "US",
    "timezone": "America/New_York"
  }'

# Expected (201):
# {
#   "success": true,
#   "company": {
#     "id": "uuid",
#     "name": "Test Company",
#     "status": "ACTIVE",
#     ...
#   }
# }
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 5.3: Call Routing
```bash
# Assuming company and employees exist:
npm run test -- call-router.service.test.ts

# Expected output:
# ✅ All routing tests passed
# ✓ should route to agent with matching skills
# ✓ should return null if no agents available
# ...
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 6: Testing Verification

### Check 6.1: Unit Tests
```bash
npm run test

# Expected output:
# Test Files  10 passed (10)
# Tests      150 passed (150)
# ✅ All tests passed
```

**If FAIL**:
```bash
# Run specific test file with verbose output
npm run test -- specific-file.test.ts --reporter=verbose

# Check for:
# 1. Database connection errors
# 2. Missing dependencies
# 3. Invalid test setup
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 6.2: Integration Tests
```bash
npm run test:integration

# Expected output:
# ✅ All integration tests passed
# - Database operations
# - API endpoints
# - Service interactions
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 6.3: E2E Tests (if implemented)
```bash
npm run test:e2e

# Expected:
# ✅ All user flows tested
# - Login flow
# - Company creation flow
# - Call placement flow
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 7: Environment Verification

### Check 7.1: All Required Variables Set
```bash
# Create verification script
cat > scripts/verify-env.js << 'EOF'
const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PORT',
  'NODE_ENV'
];

const optional = [
  'STRIPE_SECRET_KEY',
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'SENTRY_DSN'
];

console.log('REQUIRED VARIABLES:');
required.forEach(v => {
  const status = process.env[v] ? '✅' : '❌';
  console.log(`${status} ${v}`);
});

console.log('\nOPTIONAL VARIABLES:');
optional.forEach(v => {
  const status = process.env[v] ? '✅' : '⚠️ ';
  console.log(`${status} ${v}`);
});
EOF

node scripts/verify-env.js

# Expected:
# REQUIRED VARIABLES:
# ✅ DATABASE_URL
# ✅ JWT_SECRET
# ✅ PORT
# ✅ NODE_ENV
#
# OPTIONAL VARIABLES:
# ✅ STRIPE_SECRET_KEY
# ✅ OPENAI_API_KEY
# ...
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 7.2: Security Check
```bash
# Check for exposed secrets in code
npm install -g git-secrets
git secrets --scan

# Expected output:
# ✅ No secrets found
```

**If FAIL** (secrets found):
```bash
# Remove from git history (⚠️ destructive)
git filter-branch --force --index-filter \
  'git rm -r --cached --ignore-unmatch .env *.key firebase-*.json' \
  --prune-empty --tag-name-filter cat -- --all

# Or use BFG repo-cleaner:
git clone --mirror https://github.com/your-repo.git
bfg -b 'your-secret-key' your-repo.git
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## PHASE 8: Performance Verification

### Check 8.1: Load Time
```bash
# Measure homepage load time
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000

# Create curl-format.txt:
cat > curl-format.txt << 'EOF'
    time_namelookup:  %{time_namelookup}\n
    time_connect:     %{time_connect}\n
    time_appconnect:  %{time_appconnect}\n
    time_redirect:    %{time_redirect}\n
    time_starttransfer: %{time_starttransfer}\n
    time_total:       %{time_total}\n
EOF

# Expected:
# time_total: < 500ms (good)
# time_total: < 1000ms (acceptable)
# time_total: > 2000ms (needs optimization)
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

### Check 8.2: API Response Time
```bash
# Measure API endpoint
time curl http://localhost:3000/api/health

# Expected: < 100ms

# If slow, check:
# 1. Database query performance
# 2. Network latency
# 3. Server resources (CPU, memory)
```

**Status**: [ ] ✅ PASS [ ] ❌ FAIL

---

## FINAL CHECKLIST

```
PHASE 1: System Setup
☐ Check 1.1: Node.js & NPM installed
☐ Check 1.2: Dependencies installed
☐ Check 1.3: Database connection verified

PHASE 2: Build
☐ Check 2.1: TypeScript compilation passes
☐ Check 2.2: Linting passes
☐ Check 2.3: Build succeeds

PHASE 3: Runtime
☐ Check 3.1: Dev server starts
☐ Check 3.2: Frontend loads
☐ Check 3.3: API health endpoint works

PHASE 4: Database
☐ Check 4.1: All tables exist
☐ Check 4.2: Schema is correct
☐ Check 4.3: Data operations work

PHASE 5: Features
☐ Check 5.1: Authentication works
☐ Check 5.2: Company creation works
☐ Check 5.3: Call routing works

PHASE 6: Testing
☐ Check 6.1: Unit tests pass
☐ Check 6.2: Integration tests pass
☐ Check 6.3: E2E tests pass (if any)

PHASE 7: Environment
☐ Check 7.1: All required variables set
☐ Check 7.2: No secrets exposed

PHASE 8: Performance
☐ Check 8.1: Load time acceptable
☐ Check 8.2: API response time < 100ms
```

---

## 🎯 SYSTEM READY WHEN

**ALL checks above are ✅ PASS**

Then you can:
1. ✅ Proceed to [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)
2. ✅ Start Week 1 tasks from [DEVELOPER_TASK_CHECKLIST.md](DEVELOPER_TASK_CHECKLIST.md)
3. ✅ Deploy to production with confidence

---

## 🆘 COMMON FAILURES & FIXES

### "Database connection refused"
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Test connection
psql $(echo $DATABASE_URL | cut -d'?' -f1)

# If fails, whitelist IP in Neon
# https://console.neon.tech → Network Access
```

### "Port 3000 already in use"
```bash
# Find what's using port 3000
lsof -i :3000
# or (Windows):
netstat -ano | findstr :3000

# Kill it
kill -9 <PID>
# or (Windows):
taskkill /PID <PID> /F

# Start server
npm run dev
```

### "TypeError: Cannot find module"
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
rm -rf .tsbuildinfo

# Verify imports are correct
npm run typecheck
```

### "Migration failed: table already exists"
```bash
# Check what's in database
psql $DATABASE_URL -c "SELECT * FROM pg_tables WHERE schemaname='public';"

# If tables exist but schema is wrong:
npm run db:reset  # ⚠️ DELETES ALL DATA
npm run db:push
```

---

**Questions?** See [IMMEDIATE_ACTION_PLAN.md](IMMEDIATE_ACTION_PLAN.md) for troubleshooting.

**Ready?** Start with Phase 1 and work through each phase.

**Status**: [ ] System fully verified and ready ✅
