#!/bin/bash
# Neura-Talk Production Operations Shield
# Purpose: Kill zombie processes, verify ports, and test DB connectivity

echo "🚀 Starting Neura-Talk Operations Health Check..."

# 1. Kill all Node/NPM processes properly
echo "🧹 Cleaning up ghost processes..."
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    taskkill //F //IM node.exe //T 2>/dev/null
    taskkill //F //IM npm.exe //T 2>/dev/null
else
    pkill -9 node 2>/dev/null
    pkill -9 npm 2>/dev/null
fi
sleep 1

# 2. Verify Ports (5000, 5001, 5173)
PORTS=(5000 5001 5173)
for PORT in "${PORTS[@]}"; do
    PID=$(lsof -t -i:$PORT)
    if [ -n "$PID" ]; then
        echo "⚠️ Port $PORT still busy by PID $PID. Force killing..."
        kill -9 $PID
    else
        echo "✅ Port $PORT is free."
    fi
done

# 3. Database Connectivity Test
echo "🔌 Checking Database connection..."
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
    echo "⚠️ DATABASE_URL not found in environment or .env file."
    exit 1
fi

psql "$DATABASE_URL" -tAc "SELECT 1;" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Database connection successful."
else
    echo "❌ ERROR: Database timeout or connection refused. Check Neon dashboard IP whitelisting."
    exit 1
fi

# 4. Performance Optimization: Clean Vite/Build cache
echo "⚡ Optimizing build cache..."
rm -rf client/dist node_modules/.vite .next

# 5. Security Pre-check
node scripts/security-audit.js

echo "✨ System is UNBLOCKED and STRONG. You can now run: npm run dev"
exit 0