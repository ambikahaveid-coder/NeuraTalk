# 🚨 IMMEDIATE ACTION PLAN - UNBLOCK SYSTEM TODAY

**Goal**: Get the system running end-to-end within 24 hours  
**Status**: 🔴 BLOCKED - Cannot proceed with new features until these are fixed  
**Time**: 4-6 hours estimated

---

## 🚀 AUTOMATED FIX (Recommended)
Run the following command to automatically clear all blockers, check security, and verify the DB:
```bash
bash scripts/production-unblocker.sh
```

---

## ❌ MANUAL TROUBLESHOOTING

### 1. Node Process Still Running
```powershell
# Find all node processes
Get-Process node | Select-Object Id, Name

# Kill all node processes
Stop-Process -Name node -Force

# Verify
Get-Process node  # Should return nothing

# Check port 3000
netstat -ano | findstr :3000
# If something is running:
taskkill /PID <PID> /F
```

**Estimated Time**: 5 minutes

---

### 2. Database Not Connected
**Problem**: Drizzle migrations failing, cannot create tables  
**Impact**: Can't store data for companies, employees, calls

**Fix**: 
```bash
# 1. Verify environment variable
echo $DATABASE_URL
# Expected: postgresql://user:pass@host:port/database

# 2. Test connection
psql $DATABASE_URL -c "SELECT 1;"
# Expected: Should connect without error

# 3. If failed, update .env
# File: .env.production or .env.local
DATABASE_URL="postgresql://postgres:password@neuratalkneon.postgres.neon.tech:5432/neuratalk"

# 4. Then retry migration
npm run db:push

# 5. Verify tables exist
psql $DATABASE_URL -c "
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema='public' 
LIMIT 10;"
```

**If still failing**:
```bash
# Check Neon connection
psql -h neuratalkneon.postgres.neon.tech -U postgres -d neuratalk

# If blocked by IP, whitelist your IP in Neon dashboard
# https://console.neon.tech → Project → Network Access

# Or use Neon CLI
neon auth
neon projects list
neon databases list
```

**Estimated Time**: 15-30 minutes

---

### 3. Frontend Build Failing
**Problem**: Client bundle won't build, dev server crashes  
**Impact**: Cannot test UI, can't see errors in real-time

**Fix**:
```bash
# 1. Clean everything
rm -rf node_modules package-lock.json
npm install

# 2. Check for TypeScript errors
npm run typecheck

# If errors:
# - Look for "client/src" folder
# - Check vite.config.ts for correct paths
# - Ensure all imports are correct

# 3. Try dev server
npm run dev

# 4. Check for specific errors
npm run build:client 2>&1 | head -50
```

**Common fixes**:
```typescript
// If imports fail, check file exists
// ❌ Wrong:
import { Component } from "@/components/index"
// ✅ Right:
import { Component } from "@/components/Component"

// If config fails, verify vite.config.ts has:
export default defineConfig({
  client: {
    entry: resolve(__dirname, 'client/src/main.tsx')
  }
})
```

**Estimated Time**: 30 minutes

---

### 4. Environment Variables Missing
**Problem**: `.env` file not configured, secrets exposed or missing  
**Impact**: Cannot connect to payment API, auth broken, emails not sending

**Fix**:
```bash
# 1. Create .env.production
cat > .env.production << 'EOF'
# Database
DATABASE_URL=postgresql://user:pass@host:5432/neuratalk

# Server
PORT=3000
NODE_ENV=production
HOSTNAME=neuratalk.prod.com

# Security
JWT_SECRET=your-super-secret-key-here-min-32-chars
SESSION_SECRET=another-secret-min-32-chars

# Payment
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLIC_KEY=pk_live_...

# Email
SENDGRID_API_KEY=YOUR_SENDGRID_API_KEY_HERE
ADMIN_EMAIL=admin@neuratalk.com

# External Services
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
ELEVENLAB_API_KEY=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# Error Tracking
SENTRY_DSN=https://xxx@sentry.io/xxx

# Optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
EOF

# 2. Move secrets to AWS Secrets Manager
# (For production, don't store in .env files)

# 3. Update deployment script to inject secrets
# CI/CD should pull from AWS, NOT from .env

# 4. Verify all required variables are set
npm run check-env
# Create this script in package.json:
# "check-env": "node scripts/check-env.js"
```

**Script: `scripts/check-env.js`**:
```javascript
const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'OPENAI_API_KEY'
];

const missing = required.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.error('❌ Missing environment variables:');
  missing.forEach(v => console.error(`  - ${v}`));
  process.exit(1);
}

console.log('✅ All required environment variables are set');
```

**Estimated Time**: 20 minutes

---

### 5. Database Credentials Exposed in Repository
**Problem**: Firebase key, AWS secret, API keys visible in GitHub  
**Impact**: Security vulnerability, anyone can access your data

**Fix**:
```bash
# 1. IMMEDIATELY revoke all exposed keys
# - Delete Firebase service account key
# - Rotate AWS IAM keys
# - Regenerate API keys in all dashboards
# - https://www.revoke.dev (for automatic scanning)

# 2. Clean git history
# ⚠️ THIS IS DESTRUCTIVE - backup first!
git clone https://github.com/YOUR-REPO.git neuratalk-clean
cd neuratalk-clean

# Remove all secrets from history
git filter-branch --force --index-filter \
  'git rm -r --cached --ignore-unmatch attached_assets/*.txt' \
  --prune-empty --tag-name-filter cat -- --all

# Force push (⚠️ ALL CONTRIBUTORS MUST RE-CLONE)
git push origin master --force

# 3. Add .gitignore
echo "
# Credentials
.env
.env.local
.env.production
attached_assets/*.txt
firebase-*.json
*.pem
*.p12
.DS_Store
node_modules/
dist/
build/
.git-credentials
" > .gitignore

git add .gitignore
git commit -m "Add credentials to .gitignore and remove from history"
git push

# 4. Monitor for future leaks
# Use: npm install -g git-secrets
git secrets --install
git secrets --register-aws
```

**Estimated Time**: 30 minutes

---

### 6. Payment Integration Not Connected
**Problem**: Stripe API not initialized, payment flow returns errors  
**Impact**: Cannot charge users, cannot test billing

**Fix**:
```bash
# 1. Get Stripe keys from dashboard
# https://dashboard.stripe.com/apikeys

# 2. Add to .env
STRIPE_SECRET_KEY=sk_test_...  # or sk_live_ for production
STRIPE_PUBLIC_KEY=pk_test_...

# 3. Create payment service
# File: server/services/payment.service.ts

# 4. Initialize Stripe
npm install stripe

# 5. Test connection
curl https://api.stripe.com/v1/account \
  -u <YOUR_STRIPE_SECRET_KEY>:

# Should return account details (not error 401/403)
```

**Code: `server/services/payment.service.ts`**:
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
});

export const paymentService = {
  async createPaymentIntent(amount: number, customerId?: string) {
    return await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      customer: customerId,
    });
  },

  async getCustomer(customerId: string) {
    return await stripe.customers.retrieve(customerId);
  },
};
```

**Estimated Time**: 20 minutes

---

## 🔧 STEP-BY-STEP UNBLOCK PROCEDURE

**Estimated Total Time**: 4-6 hours

### Phase 1: Kill & Clean (30 min)
```bash
# 1. Stop all processes
pkill -f node
pkill -f npm

# 2. Clean build artifacts
rm -rf dist/ build/ .next/ node_modules/

# 3. Backup database (if possible)
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 4. Verify clean state
ps aux | grep node  # Should be empty
```

### Phase 2: Install & Verify (1 hour)
```bash
# 1. Fresh install
npm install

# 2. Type check
npm run typecheck

# 3. Environmental check
npm run check-env

# 4. Database migration
npm run db:push

# 5. Verify database
psql $DATABASE_URL -c "SELECT * FROM information_schema.tables LIMIT 10;"
```

### Phase 3: Build (1-2 hours)
```bash
# 1. Build backend
npm run build:server

# 2. Build frontend
npm run build:client

# 3. Build check
npm run build

# Expect: ✅ Built successfully
```

### Phase 4: Test Run (1-2 hours)
```bash
# 1. Start dev server
npm run dev

# 2. Open browser
open http://localhost:3000

# 3. Check console for errors
# Should see: "✅ Server listening on port 3000"

# 4. Test API
curl http://localhost:3000/api/health
# Expected: { "status": "healthy" }

# 5. Run core tests
npm run test

# Expected: ✅ All tests passing
```

---

## 📋 UNBLOCK CHECKLIST

```bash
☐ All node processes killed
☐ Database connection verified  
☐ .env configured with all secrets
☐ npm install completed without errors
☐ npm run typecheck passes
☐ npm run build succeeds
☐ npm run dev starts server
☐ curl http://localhost:3000/api/health works
☐ npm run test passes
☐ Browser loads http://localhost:3000 without errors
☐ Git history cleaned (credentials removed)
```

---

## ⚠️ IF SOMETHING STILL FAILS

**Database Issues**:
```bash
# Verify Neon access
psql -h neuratalkneon.postgres.neon.tech -U postgres -d neuratalk

# Check logs
tail -100 /var/log/postgresql/postgresql.log

# Reset database (⚠️ DESTRUCTIVE)
npm run db:reset  # Deletes all data!
npm run db:push   # Re-creates tables
npm run db:seed   # Re-populates test data
```

**Build Issues**:
```bash
# Check errors
npm run build 2>&1 | tee build.log

# Find problematic file
grep "error" build.log | head -5

# Clean cache
npm run clean || rm -rf node_modules .next dist
npm install
npm run build
```

**Import Errors**:
```bash
# Check file exists
ls client/src/main.tsx

# Fix imports
find client/src -name "*.tsx" -o -name "*.ts" | 
xargs grep -l "@/components" |
xargs sed -i 's|@/components/|@/components/|g'
```

---

## 🚀 AFTER UNBLOCKING

Once all blockers are cleared:

1. ✅ Run [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)
2. ✅ Assign developers to Week 1 tasks
3. ✅ Daily standup on progress
4. ✅ Code review on all PRs
5. ✅ Deploy to staging after each week

---

## 💰 COST TRACKING

| Service | Cost | Status |
|---------|------|--------|
| Neon Postgres | $15/month | ✅ Active |
| Stripe | 2.9% + $0.30/transaction | ⚠️ Verify working |
| OpenAI API | ~$50/month | ⚠️ Needs testing |
| Twilio | $1 + usage | ⚠️ Needs testing |
| Sentry | $0 (free) | ⚠️ Setup pending |
| AWS | $0-50/month | ⚠️ Only secrets manager |
| Vercel | $0 (free tier) | ✅ If using Vercel |
| **TOTAL** | ~**$70-150/month** | |

**Next step**: Migrate to AWS Secrets Manager to stop storing keys in .env files.

---

**Status**: Ready to proceed?  
**Contact**: Escalate blockers immediately if stuck > 30 min  
**Timeline**: Complete by EOD  
**Next**: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)
