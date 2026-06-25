# NeuraTalk - Production Deployment & Hosting Guide

**Version 2.0 â€” February 2026**
**Mindwhile IT Solutions Pvt Ltd**

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Architecture Overview](#2-architecture-overview)
3. [Environment Variables](#3-environment-variables)
4. [Database Setup](#4-database-setup)
5. [Building for Production](#5-building-for-production)
6. [Deployment Options](#6-deployment-options)
7. [AWS Deployment (Recommended)](#7-aws-deployment-recommended)
8. [DigitalOcean Deployment](#8-replit-deployment)
9. [VPS/Self-Hosted Deployment](#9-vpsself-hosted-deployment)
10. [Payment Gateway Configuration](#10-payment-gateway-configuration)
11. [SSL/TLS & Domain Setup](#11-ssltls--domain-setup)
12. [WebRTC & TURN Server Setup](#12-webrtc--turn-server-setup)
13. [Database Backup & Recovery](#13-database-backup--recovery)
14. [Monitoring & Health Checks](#14-monitoring--health-checks)
15. [Scaling Guide](#15-scaling-guide)
16. [Security Checklist](#16-security-checklist)
17. [Troubleshooting](#17-troubleshooting)
18. [Employee Onboarding](#18-employee-onboarding)

---

## 1. System Requirements

### Minimum Server Requirements
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 vCPU | 8+ vCPU (For Redis & Local AI) |
| RAM | 8 GB | 16+ GB (Redis handles high concurrency) |
| GPU | N/A | NVIDIA T4/L4 (Local STT/TTS requires CUDA) |
| Storage | 20 GB SSD | 50+ GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04/24.04 LTS |
| Node.js | 20.x LTS | 20.x LTS |
| PostgreSQL | 15+ | 16+ |

### Software Dependencies
- **Node.js 20.x** (with npm)
- **PostgreSQL 15+** (managed service recommended)
- **Redis 7.x** (Required for Signaling Scale)
- **ffmpeg** (for audio format conversion)
- **nginx** (as reverse proxy, optional for non-Replit)
- **PM2** or **systemd** (process manager for production)

### Optional for AI Features
- GPU server for self-hosted AI models (Whisper, NLLB, RVC)
- Redis for session caching at scale

---

## 2. Architecture Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    Client (Browser/App)                   â”‚
â”‚         React SPA / Flutter App / React Native           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                     â”‚ HTTPS
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚              Reverse Proxy (nginx/DigitalOcean)                 â”‚
â”‚            SSL Termination, Rate Limiting                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                     â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚              Node.js Express Server (Port 5000)          â”‚
â”‚                                                          â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”              â”‚
â”‚  â”‚ REST API â”‚  â”‚WebSocket â”‚  â”‚ SDK API  â”‚              â”‚
â”‚  â”‚ Routes   â”‚  â”‚Signaling â”‚  â”‚ Routes   â”‚              â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜              â”‚
â”‚                                                          â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”              â”‚
â”‚  â”‚ Auth &   â”‚  â”‚ Billing  â”‚  â”‚ Voice AI â”‚              â”‚
â”‚  â”‚ Sessions â”‚  â”‚ Engine   â”‚  â”‚ Pipeline â”‚              â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                     â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚              PostgreSQL Database                         â”‚
â”‚              62 Tables, Full ACID                        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 3. Environment Variables

### Required (Production)

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/neuratalk

# Redis (Scale Ready)
REDIS_URL=redis://default:password@host:6379
WS_SCALING_ENABLED=true

# Authentication
SESSION_SECRET=your-256-bit-random-secret-here

# AI Services (OpenAI via Replit Integrations or direct)
OPENAI_API_KEY=sk-xxxxx  # Or use Replit AI Integrations
# OpenAI API Key:
AI_INTEGRATIONS_OPENAI_API_KEY=auto-configured
AI_INTEGRATIONS_OPENAI_BASE_URL=auto-configured

# Payment - Razorpay (USD & INR)
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx

# Twilio (for SIM calls & TURN servers)
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx  # Default system number
USE_USER_CALLER_ID=true           # Allow using verified user numbers as Caller ID

# Firebase (for phone OTP in production)
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

### Optional

```bash
# Object Storage
DEFAULT_OBJECT_STORAGE_BUCKET_ID=auto-configured
PUBLIC_OBJECT_SEARCH_PATHS=auto-configured
PRIVATE_OBJECT_DIR=auto-configured

# Super Admin
SUPER_ADMIN_EMAIL=admin@neuratalk.com
SUPER_ADMIN_PHONE=+91xxxxxxxxxx

# WebRTC TURN Configuration
TURN_SERVER_URL=turn:your-domain.com:3478?transport=udp
TURN_SERVER_USERNAME=neuratalk_user
TURN_SERVER_CREDENTIAL=your_secure_password

# Sentry Error Tracking (Market Leader Reliability)
SENTRY_DSN=https://your-sentry-id@sentry.io/project
SENTRY_ENVIRONMENT=production

# Global System Controls
MAINTENANCE_MODE=false
ADMIN_IP_WHITELIST=127.0.0.1,your-office-ip

# Local AI Fallback (Dependency Zero Policy)
USE_LOCAL_AI=true
LOCAL_WHISPER_URL=http://localhost:8001/v1
LOCAL_PIPER_URL=http://localhost:8002/v1
LOCAL_WAV2LIP_URL=http://localhost:8003/v1

# Data Residency (Compliance)
DATA_RESIDENCY_REGION=ap-south-1
DPDP_COMPLIANCE_ENABLED=true

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

---

## 4. Database Setup

### Initial Setup

```bash
# 1. Create PostgreSQL database
createdb neuratalk

# 2. Set DATABASE_URL
export DATABASE_URL=postgresql://user:password@localhost:5432/neuratalk

# 3. Push schema (creates all 62 tables)
npm run db:push

# 4. Seed initial data (super admin, billing plans, etc.)
npm run dev  # Auto-seeds on first start
```

### Database Tables (62 total)

**Core Tables:**
- `users` â€” User accounts (67 users across 5 roles)
- `organizations` â€” B2B tenant companies (9 orgs)
- `user_sessions` â€” Active login sessions
- `otp_challenges` â€” OTP verification codes

**Communication:**
- `conversations` â€” Chat threads
- `messages` â€” Chat messages
- `bridged_calls` â€” SIM-to-SIM call records
- `call_telemetry` â€” Call quality metrics
- `call_participants` â€” Multi-party call tracking
- `call_translations` â€” Translation records
- `call_consents` â€” User consent for recording
- `meeting_rooms` â€” Meeting hub rooms
- `meeting_participants` â€” Meeting attendees
- `voice_memos` â€” Voice memo recordings
- `group_chats` â€” Group conversations
- `group_chat_members` â€” Group membership
- `group_chat_messages` â€” Group messages
- `signaling_sessions` â€” WebRTC signaling state

**Voice & AI:**
- `voice_profiles` â€” User voice identity profiles
- `voice_samples` â€” Voice training audio samples
- `ai_personas` â€” AI assistant personalities

**Billing:**
- `billing_plans` â€” Subscription plans (10 plans: B2C + B2B)
- `subscriptions` â€” Active user subscriptions
- `invoices` â€” Generated invoices
- `invoice_line_items` â€” Invoice details
- `credit_ledger` â€” B2B credit transactions
- `usage_records` â€” API/call usage tracking
- `billing_settings` â€” Organization billing config
- `gst_settings` â€” India GST tax configuration
- `payment_gateways` â€” Configured payment providers
- `payment_transactions` â€” Payment records

**Enterprise:**
- `enterprise_api_keys` â€” SDK activation keys
- `audit_logs` â€” Admin action audit trail (128 entries)
- `feature_flags` â€” Feature toggle system
- `custom_roles` â€” Custom RBAC roles
- `ip_whitelists` â€” IP-based access control
- `rate_limit_rules` â€” API rate limit config
- `rate_limit_buckets` â€” Rate limit state
- `abuse_reports` â€” User-reported issues

**Platform:**
- `platform_settings` â€” Global configuration
- `platform_secrets` â€” Encrypted API keys
- `environment_configs` â€” Environment-specific config
- `support_contacts` â€” Support contact info + form submissions
- `legal_content` â€” Dynamic legal page content
- `app_versions` â€” Mobile app version tracking
- `system_health_logs` â€” System monitoring
- `backup_jobs` â€” Backup history
- `registered_devices` â€” User device tracking

**Compliance:**
- `user_consents` â€” GDPR consent records
- `user_suspensions` â€” Account suspension history
- `user_accessibility_prefs` â€” A11y preferences
- `user_analytics` â€” Analytics data
- `data_residency_policies` â€” Data location rules
- `data_subject_requests` â€” GDPR data requests

**Geography:**
- `countries` â€” Country list
- `states` â€” State/province list
- `districts` â€” District list
- `cities` â€” City list
- `pincodes` â€” PIN/ZIP codes
- `villages` â€” Village list
- `supported_languages` â€” Language configuration
- `org_members` â€” Organization membership

---

## 5. Building for Production

```bash
# Install dependencies
npm install

# Build the application
npm run build

# This creates:
# - dist/index.cjs (~1.8 MB) â€” Server bundle
# - dist/public/ â€” Frontend static files

# Start production server
npm run start
# Or: node dist/index.cjs
```

### Build Output
```
dist/
â”œâ”€â”€ index.cjs          # Node.js server (Express + all APIs)
â””â”€â”€ public/            # React frontend (static files)
    â”œâ”€â”€ index.html
    â”œâ”€â”€ assets/
    â”‚   â”œâ”€â”€ index-xxxx.js
    â”‚   â””â”€â”€ index-xxxx.css
    â””â”€â”€ ...
```

---

## 6. Deployment Options

| Option | Cost | Complexity | Best For |
|--------|------|-----------|----------|
| DigitalOcean | $12+/mo | High | Production | Low | Dev/Staging |
| AWS EC2 + RDS | $50-200/mo | Medium | Production |
| AWS ECS/Fargate | $80-300/mo | High | Scale |
| DigitalOcean | $24-96/mo | Low-Med | Small prod |
| Self-hosted VPS | $20-100/mo | Medium | Budget |

---

## 7. AWS Deployment (Recommended)

### EC2 + RDS Setup

```bash
# 1. Launch EC2 (t3.medium or larger)
# - Ubuntu 22.04 LTS AMI
# - Security group: ports 22, 80, 443, 5000

# 2. Create RDS PostgreSQL
# - db.t3.micro or larger
# - PostgreSQL 16
# - Enable backups (7-day retention)

# 3. SSH into EC2
ssh -i key.pem ubuntu@your-ec2-ip

# 4. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg nginx

# 5. Install PM2
sudo npm install -g pm2

# 6. Clone/upload code
git clone your-repo /opt/neuratalk
cd /opt/neuratalk
npm install
npm run build

# 7. Set environment variables
cat > /opt/neuratalk/.env <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@rds-endpoint:5432/neuratalk
SESSION_SECRET=$(openssl rand -hex 32)
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
EOF

# 8. Start with PM2
pm2 start dist/index.cjs --name neuratalk
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name neuratalk.com www.neuratalk.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name neuratalk.com www.neuratalk.com;

    ssl_certificate /etc/letsencrypt/live/neuratalk.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/neuratalk.com/privkey.pem;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 8. DigitalOcean Deployment

Already configured. Deploy via DigitalOcean App Platform:

1. Go to DigitalOcean App Platform dashboard
2. Build command: `npm run build`
3. Run command: `npm run start`
4. Machine type: Autoscale
5. Custom domain: Configure in Deploy settings

Deployment config is in .

---

## 9. VPS/Self-Hosted Deployment

```bash
# 1. Install requirements
sudo apt update && sudo apt install -y nodejs npm postgresql ffmpeg nginx certbot

# 2. Setup PostgreSQL
sudo -u postgres createdb neuratalk
sudo -u postgres psql -c "CREATE USER ntuser WITH PASSWORD 'secure-password';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE neuratalk TO ntuser;"

# 3. Deploy code
cd /opt/neuratalk
npm install && npm run build

# 4. Create systemd service
sudo tee /etc/systemd/system/neuratalk.service <<EOF
[Unit]
Description=NeuraTalk Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/neuratalk
ExecStart=/usr/bin/node dist/index.cjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/neuratalk/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable neuratalk
sudo systemctl start neuratalk

# 5. SSL with Let's Encrypt
sudo certbot --nginx -d neuratalk.com -d www.neuratalk.com
```

---

## 10. Payment Gateway Configuration

### Razorpay (USD & INR)

```bash
# 1. Create Razorpay account at https://razorpay.com
# 2. Get API keys from Dashboard > Settings > API Keys
# 3. Set environment variables:
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
```

**Current Plans (USD):**

| Plan | Price | Type | Included |
|------|-------|------|----------|
| Free Trial | $0 | B2C | 30 min translation |
| Weekly | $4.99/wk | B2C | 120 min/week |
| Monthly | $14.99/mo | B2C | 500 min/month |
| Quarterly | $34.99/qtr | B2C | 1500 min/quarter |
| Yearly | $99.99/yr | B2C | 6000 min/year |
| Enterprise | Custom | B2C | Unlimited |
| Starter | $49.99/mo | B2B | 500 min, 5 users |
| Business | $149.99/mo | B2B | 2000 min, 20 users |
| Professional | $299.99/mo | B2B | 5000 min, 50 users |
| Enterprise | Custom | B2B | Unlimited |

### Razorpay (Secondary - Indian Market)

```bash
# 1. Create Razorpay account at https://razorpay.com
# 2. Get API keys from Dashboard > Settings > API Keys
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx

# Webhook URL: https://yourdomain.com/api/razorpay/webhook
```

### Updating Prices

Prices are stored in the `billing_plans` database table. To update:

```sql
-- Update B2C Monthly price (stored in cents for USD)
UPDATE billing_plans 
SET price_monthly = '19.99'
WHERE name = 'Monthly' AND type = 'b2c';

-- Update B2B Starter price
UPDATE billing_plans 
SET price_monthly = '59.99'
WHERE name = 'Starter' AND type = 'b2b';

-- Add a new plan
INSERT INTO billing_plans (name, type, description, price_monthly, price_yearly, currency, call_minutes_included, translation_minutes_included, voice_minutes_included, users_included, is_active)
VALUES ('Premium', 'b2c', 'Premium plan with priority support', '29.99', '299.99', 'USD', 2000, 2000, 2000, 1, true);
```

---

## 11. SSL/TLS & Domain Setup

```bash
# Using Let's Encrypt (free)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d neuratalk.com -d www.neuratalk.com -d api.neuratalk.com

# Auto-renewal (already set up by certbot)
sudo certbot renew --dry-run
```

---

## 12. WebRTC & TURN Server Setup

### Option A: Twilio TURN (Easiest)
Already integrated. Set Twilio credentials and the app auto-fetches TURN/STUN servers.

### Option B: Self-hosted coturn

```bash
sudo apt install coturn

# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=neuratalk.com
server-name=neuratalk.com
lt-cred-mech
userdb=/etc/turnuserdb.conf
cert=/etc/letsencrypt/live/neuratalk.com/fullchain.pem
pkey=/etc/letsencrypt/live/neuratalk.com/privkey.pem

# Set env vars
TURN_SERVER_URL=turn:turn.neuratalk.com:3478
TURN_SERVER_USERNAME=neuratalk
TURN_SERVER_CREDENTIAL=your-secret
```

---

## 13. Database Backup & Recovery

### Automated Backup Script

```bash
# Run backup
chmod +x scripts/backup.sh
./scripts/backup.sh

# Output structure:
backups/neuratalk_full_YYYYMMDD_HHMMSS/
â”œâ”€â”€ database/
â”‚   â”œâ”€â”€ full_dump.sql.gz      # Complete database dump
â”‚   â”œâ”€â”€ schema.sql             # Schema only (for reference)
â”‚   â”œâ”€â”€ table_users.sql.gz     # Individual table backups
â”‚   â”œâ”€â”€ table_billing_plans.sql.gz
â”‚   â”œâ”€â”€ ... (62 table files)
â”‚   â”œâ”€â”€ table_metadata.txt     # Column counts per table
â”‚   â”œâ”€â”€ indexes.txt            # All indexes
â”‚   â””â”€â”€ foreign_keys.txt       # Foreign key relationships
â”œâ”€â”€ code/
â”‚   â”œâ”€â”€ server.tar.gz          # Application source code
â”‚   â”œâ”€â”€ flutter_app.tar.gz     # Mobile app code
â”‚   â””â”€â”€ react_native_app.tar.gz
â”œâ”€â”€ config/
â”‚   â”œâ”€â”€ backup.sh
â”‚   â””â”€â”€ restore.sh
â””â”€â”€ BACKUP_MANIFEST.txt        # Backup inventory
```

### Restore Options

```bash
# Full database restore
./scripts/restore.sh full ./backups/neuratalk_full_20260225_120000

# Single table restore
./scripts/restore.sh table users ./backups/neuratalk_full_20260225_120000

# Schema only (no data)
./scripts/restore.sh schema ./backups/neuratalk_full_20260225_120000

# List available backups
./scripts/restore.sh list

# Verify backup integrity
./scripts/restore.sh verify ./backups/neuratalk_full_20260225_120000
```

### Cron Schedule (Automated)

```bash
# Add to crontab (crontab -e)
# Daily backup at 2 AM
0 2 * * * cd /opt/neuratalk && ./scripts/backup.sh >> /var/log/neuratalk-backup.log 2>&1

# Weekly backup to S3
0 3 * * 0 aws s3 sync /opt/neuratalk/backups/ s3://neuratalk-backups/ --delete
```

---

## 14. Monitoring & Health Checks

### Built-in Health Endpoint

```bash
curl https://yourdomain.com/api/health
# {"status":"ok","timestamp":"2026-02-25T...","uptime":12345}
```

### Key Endpoints to Monitor

| Endpoint | Method | Expected |
|----------|--------|----------|
| `/api/health` | GET | `{"status":"ok"}` |
| `/api/admin/stats` | GET (auth) | User/company counts |
| `/api/rtc/status` | GET (auth) | WebRTC server status |
| `/api/calls/gateway-status` | GET (auth) | Call gateway status |

### PM2 Monitoring

```bash
pm2 status           # Process status
pm2 logs neuratalk   # View logs
pm2 monit            # Real-time monitoring
pm2 reload neuratalk # Zero-downtime restart
```

### Log Rotation

```bash
# /etc/logrotate.d/neuratalk
/opt/neuratalk/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
```

---

## 15. Scaling Guide

### Horizontal Scaling

```
                    â”Œâ”€â”€â”€ Node.js Instance 1 (Port 5000)
Load Balancer â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€ Node.js Instance 2 (Port 5001)
(nginx/ALB)         â””â”€â”€â”€ Node.js Instance 3 (Port 5002)
                              â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚  PostgreSQL (RDS)  â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Considerations for multi-instance:**
- Sessions are stored in PostgreSQL (already supports multiple instances)
- WebSocket connections need sticky sessions or Redis pub/sub
- Use `signaling_sessions` table for distributed signaling state

### Database Scaling
- **Read replicas**: Route read-heavy queries (analytics, reports) to replicas
- **Connection pooling**: Use PgBouncer for connection management
- **Partitioning**: Partition `audit_logs` and `call_telemetry` by date

---

## 16. Security Checklist

- [ ] All env vars set (no defaults in production)
- [ ] `NODE_ENV=production` set
- [ ] SSL/TLS configured with valid certificate
- [ ] Database accessible only from application server (not public)
- [ ] Razorpay API keys configured
- [ ] Firebase service account secured
- [ ] TURN server credentials set
- [ ] Rate limiting enabled
- [ ] CORS configured for your domain only
- [ ] Security headers (HSTS, CSP, X-Frame-Options) via nginx
- [ ] Database backups enabled and tested
- [ ] Super admin password/OTP configured for production
- [ ] IP whitelist for admin endpoints (optional)
- [ ] Audit logging enabled and monitored

---

## 17. Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Port 5000 already in use | Previous instance still running | `pkill -f "node dist/index.cjs"` and restart |
| Database connection refused | Wrong DATABASE_URL or DB down | Check `pg_isready` and verify URL |
| WebSocket not connecting | Proxy not forwarding upgrades | Add WebSocket headers to nginx config |
| Razorpay payments failing | Wrong API keys | Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET |
| TTS/STT not working | OpenAI API key not set | Check OPENAI_API_KEY or AI Integrations |
| OTP not sending | Firebase not configured | Set FIREBASE_SERVICE_ACCOUNT_JSON or use dev mode |
| TURN server timeout | TURN not configured | Set up Twilio or coturn |
| Slow translation | Network latency to OpenAI | Consider self-hosted models |
| Build fails | TypeScript errors | Run `npx tsc --noEmit` to check |

### Quick Diagnostics

```bash
# Check server status
curl -s http://localhost:5000/api/health

# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check table counts
psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE schemaname='public'" | wc -l

# Check Node.js process
pm2 status

# View last 50 error logs
pm2 logs neuratalk --lines 50 --err

# Test super admin login
curl -s http://localhost:5000/api/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@neuratalk.com","channel":"email"}'
```

---

## 18. Employee Onboarding

### For New Developers

1. **Read EMPLOYEE_GUIDE.md** â€” Full platform overview, architecture, role system
2. **Set up local dev**: `npm install && npm run dev`
3. **Login as super admin**: admin@neuratalk.com, OTP code: 123456 (dev mode)
4. **Explore dashboards**: Navigate all 8 tabs in super admin dashboard
5. **Test SDK**: Create an API key, activate it, test translation endpoint
6. **Review code structure**:
   - `server/` â€” Backend (Express, routes, middleware)
   - `client/src/` â€” Frontend (React, pages, components)
   - `shared/` â€” Shared types and schema
   - `flutter_app/` â€” Mobile app

### For QA/Testing

1. Test all role logins: super_admin, company_admin, investor, agent, consumer
2. Verify role protection (consumers can't access admin pages)
3. Test call flows (SIM, video, face-to-face)
4. Test billing (subscribe, invoice generation)
5. Test SDK endpoints with API keys
6. Verify legal pages are current (Feb 2026, USD)

### For DevOps

1. Set up all environment variables (see Section 3)
2. Configure payment gateways (Section 10)
3. Set up SSL certificates (Section 11)
4. Configure TURN server for WebRTC (Section 12)
5. Set up automated backups (Section 13)
6. Configure monitoring and alerts (Section 14)
7. Review security checklist (Section 16)

---

## Appendix: File Structure

```
neuratalk/
â”œâ”€â”€ server/                     # Backend
â”‚   â”œâ”€â”€ index.ts                # Server entry point
â”‚   â”œâ”€â”€ routes.ts               # Main route registration
â”‚   â”œâ”€â”€ db.ts                   # Database connection
â”‚   â”œâ”€â”€ storage.ts              # Data access layer
â”‚   â”œâ”€â”€ role-middleware.ts       # Auth & RBAC middleware
â”‚   â”œâ”€â”€ enterprise-api-routes.ts # Enterprise SDK & API keys
â”‚   â”œâ”€â”€ enterprise-routes.ts     # Enterprise analytics
â”‚   â”œâ”€â”€ admin-user-routes.ts     # Admin management
â”‚   â”œâ”€â”€ b2b-routes.ts           # B2B features
â”‚   â”œâ”€â”€ billing-routes.ts       # Billing & subscriptions
â”‚   â”œâ”€â”€ call-routes.ts          # Voice call management
â”‚   â”œâ”€â”€ sim-bridge.ts           # SIM-to-SIM bridging
â”‚   â”œâ”€â”€ signaling-server.ts     # WebRTC signaling
â”‚   â”œâ”€â”€ voice-training.ts       # Voice identity
â”‚   â”œâ”€â”€ voice-memos.ts          # Voice memos
â”‚   â”œâ”€â”€ meeting-links.ts        # Meetings hub
â”‚   â”œâ”€â”€ audit-logging.ts        # Audit trail
â”‚   â””â”€â”€ ai_integrations/    # AI service clients
â”‚       â”œâ”€â”€ audio/              # TTS, STT, voice chat
â”‚       â”œâ”€â”€ chat/               # Text AI chat
â”‚       â””â”€â”€ image/              # Image generation
â”œâ”€â”€ client/
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ App.tsx              # Route definitions
â”‚       â”œâ”€â”€ pages/               # All page components
â”‚       â”‚   â”œâ”€â”€ SuperAdminDashboard.tsx
â”‚       â”‚   â”œâ”€â”€ CompanyAdminDashboard.tsx
â”‚       â”‚   â”œâ”€â”€ ConsumerDashboard.tsx
â”‚       â”‚   â”œâ”€â”€ InvestorDashboard.tsx
â”‚       â”‚   â””â”€â”€ website/        # Public website pages
â”‚       â”œâ”€â”€ components/          # Shared UI components
â”‚       â””â”€â”€ hooks/               # Custom React hooks
â”œâ”€â”€ shared/
â”‚   â””â”€â”€ schema.ts               # Database schema (62 tables)
â”œâ”€â”€ flutter_app/                # Flutter mobile app
â”œâ”€â”€ scripts/
â”‚   â”œâ”€â”€ backup.sh               # Full platform backup
â”‚   â””â”€â”€ restore.sh              # Database restore
â”œâ”€â”€ EMPLOYEE_GUIDE.md           # Employee documentation
â”œâ”€â”€ DEPLOYMENT_GUIDE.md         # This file
â””â”€â”€ README.md                   # Project metadata
```

