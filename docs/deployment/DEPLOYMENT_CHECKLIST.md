# 🚀 DEPLOYMENT CHECKLIST - Production Launch

**Use this checklist before EVERY deployment to production.**

---

## PRE-DEPLOYMENT (48 hours before launch)

### 1. Code Freeze & Testing (24 hours before)
- [ ] All PRs merged to `main` branch
- [ ] No commits after code freeze
- [ ] All tests passing: `npm run test`
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Production build succeeds: `npm run build`

**Checklist**:
```bash
# Run full test suite
npm run test

# Check coverage
npm run test:coverage
# Expected: >80% for critical paths

# Build for production
npm run build

# Check build size
du -sh dist/
# Expected: Client < 2MB, Server < 500KB

# No git changes
git status
# Expected: (on main branch) nothing to commit, working tree clean
```

**Owner**: Tech Lead  
**Verified**: QA Lead  
**Sign-off**: [DATE/TIME]

---

### 2. Database Backup (24 hours before)
- [ ] Full database backup created
- [ ] Backup size recorded
- [ ] Restore test completed
- [ ] Backup stored in AWS S3

**Commands**:
```bash
# Create backup
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump $DATABASE_URL > $BACKUP_FILE

# Verify
ls -lh $BACKUP_FILE
# Expected: Size > 1MB (has data)

# Test restore (on duplicate database)
createdb neuratalk_test
psql neuratalk_test < $BACKUP_FILE
psql neuratalk_test -c "SELECT COUNT(*) FROM companies;"
# Expected: Shows row count

# Upload to AWS S3
aws s3 cp $BACKUP_FILE s3://neuratalk-backups/
```

**Owner**: DevOps  
**Verified**: Tech Lead  
**Backup Location**: `s3://neuratalk-backups/`

---

### 3. Staging Environment Test (24 hours before)
- [ ] Deploy to staging environment
- [ ] Run full integration test suite
- [ ] All endpoints respond correctly
- [ ] Load test passed (100 concurrent users)
- [ ] Performance acceptable (< 500ms response time)

**Deploy to Staging**:
```bash
# Push to staging branch
git push origin main:staging

# Trigger staging deployment (CI/CD)
# Check deployment logs
# Verify all services started

# Run tests
npm run test:staging

# Load test
npm run test:load -- --concurrency=100

# Manual smoke tests
curl https://staging.neuratalk.com/api/health
# Expected: { "status": "healthy" }

# Test critical endpoints
curl https://staging.neuratalk.com/api/b2b/companies \
  -H "Authorization: Bearer $TEST_TOKEN"
# Expected: 200 OK with company list
```

**Owner**: QA  
**Results**: ✅ All tests passed  
**Environment**: `staging.neuratalk.com`

---

### 4. Security Audit (24 hours before)
- [ ] No secrets in code: `npm run audit:secrets`
- [ ] Vulnerabilities scanned: `npm audit`
- [ ] SSL certificate valid
- [ ] HTTPS enforced on all routes

**Commands**:
```bash
# Check for secrets
git secrets --scan
npm run audit:secrets
# Expected: No secrets found

# Check dependencies
npm audit
# Expected: 0 vulnerabilities (or documented exceptions)

# Check SSL
curl -I https://neuratalk.com
# Expected: HTTP/2 200 OK (SSL working)

# Verify HTTPS redirect
curl -I http://neuratalk.com
# Expected: 301 redirect to https://
```

**Owner**: Security  
**Results**: ✅ No vulnerabilities  
**SSL Certificate**: Valid until [DATE]

---

### 5. Team Notification (24 hours before)
- [ ] All team members notified of deployment
- [ ] On-call support scheduled
- [ ] Rollback plan shared
- [ ] War room scheduled (if major update)
- [ ] Customer communication prepared

**Notification Checklist**:
```markdown
Email to team:

Subject: DEPLOYMENT TONIGHT - NeuraChat v1.0.0 at 11:00 PM UTC

Team,

We're deploying NeuraChat v1.0.0 to production
**Time**: April 15, 2024 at 11:00 PM UTC
**Duration**: 15-30 minutes (expected)
**Impact**: Brief 5-minute downtime expected during database migration

SUPPORT SCHEDULE:
- On-call: [NAME]
- Backup: [NAME]
- War room: Slack #deployment-live

ROLLBACK PLAN:
If issues occur, we'll rollback to v0.9.8 (backup ready)
Rollback time: < 5 minutes

CHANGES IN THIS RELEASE:
- New B2B company management
- Improved call routing algorithm
- 15 language support

CUSTOMER COMMUNICATION:
Email + in-app notification will be sent at 10:50 PM UTC

Questions? Reply to this email.

Thanks,
[Tech Lead Name]
```

**Notification Sent**: [DATE/TIME]  
**Slack Channel**: #deployment-live

---

---

## DEPLOYMENT DAY (Actual Execution)

### PRE-LAUNCH CHECKLIST (30 minutes before)

**Window**: [START TIME] UTC

- [ ] Team in war room (Slack #deployment-live)
- [ ] Monitoring dashboards open
- [ ] Database backup verified
- [ ] Rollback plan ready
- [ ] On-call support standing by
- [ ] Customer notification prepared

**Monitoring Setup**:
```bash
# Open these in separate tabs/monitors:

1. Application Logs (Sentry)
   https://sentry.io/projects/neuratalk/issues/

2. Server Metrics (Prometheus)
   http://prometheus.neuratalk.com:9090/graph

3. Database Performance
   SELECT * FROM pg_stat_databases;

4. API Health
   curl -w "\nStatus: %{http_code}\n" https://neuratalk.com/api/health

5. Real User Monitoring (if available)
   https://dashboard.datadog.com/...

6. Slack Alerts
   #deployment-alerts (unmute notifications)
```

**Team Readiness**:
```
War Room Checklist:
☐ Tech Lead present
☐ DevOps present
☐ QA present
☐ On-call support present
☐ All monitoring open
☐ Rollback documentation reviewed
☐ Communication channels ready
☐ "Do Not Disturb" except for deployment
```

---

### DEPLOYMENT EXECUTION (20 minutes)

**Step 1: Stop Traffic (T-0:00 to T+0:05)**
```bash
# Option 1: Using load balancer
aws elb set-instance-health \
  --load-balancer-name neuratalk-prod \
  --instances i-1234567890abcdef0 \
  --state OutOfService

# Option 2: Using DNS failover
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "neuratalk.com",
        "Type": "A",
        "TTL": 60,
        "ResourceRecords": [{"Value": "maintenance.neuratalk.com"}]
      }
    }]
  }'

# Verify: Traffic should go to maintenance page
curl https://neuratalk.com
# Expected: "We'll be back soon" message
```

**Step 2: Backup Current State (T+0:05 to T+0:10)**
```bash
# Backup database AGAIN (just before change)
pg_dump $DATABASE_URL > backup_predeployment_$(date +%Y%m%d_%H%M%S).sql

# Backup current code
git tag release-v1.0.0
git push origin release-v1.0.0

# Note: Both backups ready if rollback needed
echo "✅ Backups complete"
```

**Step 3: Deploy New Code (T+0:10 to T+0:15)**
```bash
# Deploy using CI/CD (GitHub Actions, GitLab CI, etc.)
# OR manually:

ssh deploy@neuratalk-prod
cd /app/neuratalk

# Stop current server
systemctl stop neuratalk

# Deploy new code
git fetch origin main
git checkout main
git pull origin main

# Install dependencies
npm ci  # Use npm ci (not npm install) in production

# Build
npm run build

# Run migrations (if needed)
npm run db:push

# Start new server
systemctl start neuratalk

# Verify
systemctl status neuratalk
sleep 5
curl http://localhost:3000/api/health
```

**Deployment Logs**:
```
[10:15 PM] Deployment initiated
[10:15 PM] Pulling latest code...
[10:16 PM] Running migrations...
[10:17 PM] Starting new server...
[10:17 PM] Health check: OK
[10:18 PM] ✅ Deployment complete
```

**Step 4: Run Post-Deployment Tests (T+0:15 to T+0:20)**
```bash
# Quick smoke tests
npm run test:smoke

# Check critical endpoints
curl -X GET https://neuratalk.com/api/health
curl -X GET https://neuratalk.com/api/companies

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"

# Monitor errors (Sentry)
# Expected: 0-5 errors (normal baseline)

# Check logs
tail -50 /var/log/neuratalk/production.log
# Expected: No ERROR or CRITICAL messages
```

**Step 5: Restore Traffic (T+0:20 to T+0:25)**
```bash
# Option 1: Load balancer
aws elb set-instance-health \
  --load-balancer-name neuratalk-prod \
  --instances i-1234567890abcdef0 \
  --state InService

# Option 2: DNS failover
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "neuratalk.com",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [{"Value": "1.2.3.4"}]
      }
    }]
  }'

# Verify traffic is flowing
curl https://neuratalk.com
# Expected: Homepage loads
```

**Status at T+0:25**: ✅ DEPLOYMENT COMPLETE

---

### POST-DEPLOYMENT MONITORING (30 minutes after)

**T+0:30 to T+1:00 - Active Monitoring**

```bash
# Monitor every 5 minutes for 30 minutes:

# 1. Application errors
SELECT COUNT(*) FROM sentry_events 
WHERE timestamp > NOW() - INTERVAL '5 minutes'
# Expected: < 10 errors

# 2. API latency
SELECT AVG(duration_ms) FROM api_logs 
WHERE timestamp > NOW() - INTERVAL '5 minutes'
# Expected: < 500ms

# 3. Database performance
SELECT COUNT(*) FROM pg_stat_statements
WHERE query_time_sum > 1000  -- Queries taking > 1s
# Expected: 0

# 4. Server health
curl -s https://neuratalk.com/api/health | jq .
# Expected: { "status": "healthy", "uptime": "..." }

# 5. User activity
SELECT COUNT(*) FROM api_logs WHERE status_code >= 400
# Expected: < 10 per minute
```

**Monitoring Dashboard**:
```
[✅ API Response Time] 245ms (Healthy)
[✅ Error Rate] 0.1% (Acceptable)
[✅ Database CPU] 35% (Healthy)
[✅ Memory Usage] 62% (Healthy)
[✅ Disk Usage] 41% (Healthy)
```

**Status Check Spreadsheet**:
| Time | Errors | Latency | DB CPU | Status |
|------|--------|---------|--------|--------|
| T+0:30 | 2 | 240ms | 32% | ✅ OK |
| T+0:35 | 1 | 250ms | 38% | ✅ OK |
| T+0:40 | 3 | 245ms | 35% | ✅ OK |
| T+0:45 | 0 | 235ms | 34% | ✅ OK |
| T+1:00 | 1 | 242ms | 36% | ✅ STABLE |

**Status**: ✅ Deployment successful, monitoring normal

---

### CUSTOMER NOTIFICATION (Immediately after success)

**Email/In-App Message**:
```
Subject: NeuraChat v1.0.0 is Live - Here's What's New 

Hi [Customer Name],

Great news! We've just deployed NeuraChat v1.0.0 with exciting new features:

✅ Enterprise B2B Management
- Create and manage teams with custom phone numbers
- Advanced call routing (skill-based, round-robin, load-balanced)
- Real-time queue management

✅ BPO Integration
- Outsourced agent management
- Performance tracking
- Automatic call assignment

✅ Language Bridge
- 15 languages supported (real-time translation)
- Emotion detection
- AI-powered call summaries

✅ Excel Exports & Analytics
- Download call history as Excel
- Custom reports
- Real-time dashboards

WHAT'S NEXT FOR YOU:
1. Log in to your account
2. Go to Settings → Company Management
3. Add your team members
4. Set up call routing preferences

Questions? Reply to this email or contact support@neuratalk.com

Thanks,
The NeuraChat Team
```

**Slack Announcement**:
```
🚀 DEPLOYMENT SUCCESSFUL! NeuraChat v1.0.0 is now LIVE

Key Metrics:
✅ Deployment time: 15 minutes
✅ Zero downtime
✅ All tests passing (150/150)
✅ Error rate: < 0.1%
✅ Response time: 245ms avg

What's New:
• B2B company management
• Advanced call routing
• 15-language support
• Excel exports

Thanks to the team for a clean deployment! 🎉

#deployment-success
```

**Status**: ✅ Customers notified

---

---

## IF SOMETHING GOES WRONG - ROLLBACK

**Decision Point**: If error rate > 1% or latency > 2s → ROLLBACK

**Rollback Procedure**:

### Step 1: Declare Emergency (Immediately)
```bash
# Announce in war room
echo "🔴 ROLLBACK INITIATED - $(date)"

# Slack @channel alert
# Message: "Critical issue detected - rolling back to v0.9.8"

# Stop accepting new traffic
aws elb set-instance-health ... --state OutOfService
```

### Step 2: Restore Previous Code (2-3 minutes)
```bash
ssh deploy@neuratalk-prod
cd /app/neuratalk

# Stop current server
systemctl stop neuratalk

# Checkout previous version
git checkout release-v0.9.8
git pull origin release-v0.9.8

# Reinstall/rebuild
npm ci
npm run build

# Revert any database migrations (if applicable)
npm run db:rollback

# Start server
systemctl start neuratalk

# Verify
sleep 5
curl http://localhost:3000/api/health
systemctl status neuratalk
```

### Step 3: Restore Traffic (1-2 minutes)
```bash
aws elb set-instance-health ... --state InService
```

### Step 4: Verify Stability (5 minutes)
```bash
# Monitor for 5 minutes
# Expected: Error rate < 0.5%, latency < 500ms
curl -X GET https://neuratalk.com/api/health
SELECT AVG(duration) FROM api_logs WHERE timestamp > NOW() - '5 min'::interval;
```

**Total Rollback Time**: ~10 minutes

**Status**: ✅ Rolled back to v0.9.8, investigating issue

**Post-Mortem**: 
```markdown
After rollback, schedule post-mortem:
- What happened?
- Why was it not caught in staging?
- How do we prevent this next time?
- Schedule: 24 hours after rollback
- Owner: Tech Lead
```

---

---

## POST-DEPLOYMENT VALIDATION (24 hours after)

**One day after successful deployment, verify:**

- [ ] No increase in error rate
- [ ] User engagement normal
- [ ] Database performance stable
- [ ] No customer complaints
- [ ] All features working as expected
- [ ] Revenue tracking correctly

**Validation Commands**:
```bash
# Error rate over 24h
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as error_count
FROM sentry_events
WHERE timestamp > NOW() - INTERVAL '24 hours'
  AND level = 'error'
GROUP BY hour
ORDER BY hour DESC;
# Expected: Baseline level (no spikes)

# Check user logins
SELECT COUNT(*) FROM auth_logs WHERE created_at > NOW() - '24 hours'::interval;

# Check API usage
SELECT 
  endpoint,
  COUNT(*) as requests,
  AVG(duration_ms) as avg_latency
FROM api_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY endpoint
ORDER BY requests DESC;
```

**Success Criteria**:
- ✅ Error rate normal
- ✅ Performance stable
- ✅ Users happy
- ✅ No rollback needed

---

---

## POST-MORTEM & DOCUMENTATION

### What Was Deployed
- Version: 1.0.0
- Date: April 15, 2024
- Time: 11:00 PM UTC
- Duration: 15 minutes
- Downtime: 0 minutes

### Changes Included
- [ ] Database schema updates
- [ ] API endpoint changes
- [ ] UI improvements
- [ ] Performance optimizations
- [ ] Security patches

### Incidents During Deployment
- [ ] None (clean deployment)
- [ ] [INCIDENT 1]: [DESCRIPTION] - Fixed in [TIME]

### Lessons Learned
1. [What went well]
2. [What could be improved]
3. [Action items for next deployment]

### Owner Sign-Off
- **Deployed by**: [NAME]
- **Verified by**: [NAME]
- **Approved by**: [NAME]
- **Date**: April 15, 2024
- **Time**: 11:25 PM UTC

---

**Next Deployment**: [TARGET DATE]

**For future deployments, refer back to this checklist and update based on lessons learned.**
