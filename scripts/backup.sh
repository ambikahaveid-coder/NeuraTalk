#!/bin/bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_BASE="${BACKUP_DIR}/neuratalk_full_${TIMESTAMP}"

echo "============================================"
echo "  NeuraTalk Full Platform Backup"
echo "  $(date)"
echo "============================================"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set."
  exit 1
fi

mkdir -p "$BACKUP_BASE"
mkdir -p "$BACKUP_BASE/database"
mkdir -p "$BACKUP_BASE/code"
mkdir -p "$BACKUP_BASE/config"

echo ""
echo "Step 1/6: Database schema backup..."
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-acl > "$BACKUP_BASE/database/schema.sql"
echo "  ✓ Schema exported"

echo ""
echo "Step 2/6: Database full data backup..."
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_BASE/database/full_dump.sql.gz"
echo "  ✓ Full dump exported"

echo ""
echo "Step 3/6: Individual table exports..."
TABLES=$(psql "$DATABASE_URL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" 2>/dev/null)
TABLE_COUNT=0
for TABLE in $TABLES; do
  TABLE=$(echo "$TABLE" | tr -d ' ')
  if [ -n "$TABLE" ]; then
    ROW_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM \"$TABLE\"" 2>/dev/null | tr -d ' ')
    pg_dump "$DATABASE_URL" --no-owner --no-acl --table="$TABLE" --data-only 2>/dev/null | gzip > "$BACKUP_BASE/database/table_${TABLE}.sql.gz"
    echo "  ✓ $TABLE ($ROW_COUNT rows)"
    TABLE_COUNT=$((TABLE_COUNT + 1))
  fi
done
echo "  Total: $TABLE_COUNT tables backed up"

echo ""
echo "Step 4/6: Database metadata..."
psql "$DATABASE_URL" -c "
SELECT tablename as table_name, 
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = pg_tables.tablename AND table_schema = 'public') as columns
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename
" > "$BACKUP_BASE/database/table_metadata.txt" 2>/dev/null

psql "$DATABASE_URL" -c "
SELECT indexname, tablename, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname
" > "$BACKUP_BASE/database/indexes.txt" 2>/dev/null

psql "$DATABASE_URL" -c "
SELECT tc.constraint_name, tc.table_name, kcu.column_name, 
       ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name
" > "$BACKUP_BASE/database/foreign_keys.txt" 2>/dev/null
echo "  ✓ Metadata, indexes, foreign keys exported"

echo ""
echo "Step 5/6: Application code snapshot..."
tar czf "$BACKUP_BASE/code/server.tar.gz" \
  --exclude='node_modules' --exclude='.git' --exclude='backups' --exclude='dist' \
  server/ shared/ client/src/ client/public/ \
  package.json tsconfig.json vite.config.ts drizzle.config.ts \
  replit.md EMPLOYEE_GUIDE.md 2>/dev/null || true
echo "  ✓ Source code archived"

if [ -d "flutter_app" ]; then
  tar czf "$BACKUP_BASE/code/flutter_app.tar.gz" \
    --exclude='.dart_tool' --exclude='build' --exclude='.packages' \
    flutter_app/ 2>/dev/null || true
  echo "  ✓ Flutter app archived"
fi

if [ -d "react_native_app" ]; then
  tar czf "$BACKUP_BASE/code/react_native_app.tar.gz" \
    --exclude='node_modules' --exclude='build' \
    react_native_app/ 2>/dev/null || true
  echo "  ✓ React Native app archived"
fi

echo ""
echo "Step 6/6: Configuration & docs..."
cp scripts/backup.sh "$BACKUP_BASE/config/" 2>/dev/null || true
cp scripts/restore.sh "$BACKUP_BASE/config/" 2>/dev/null || true

cat > "$BACKUP_BASE/BACKUP_MANIFEST.txt" <<EOF
NeuraTalk Full Platform Backup
==============================
Backup Date: $(date)
Backup ID: $TIMESTAMP

DATABASE
--------
Tables: $TABLE_COUNT
Full dump: database/full_dump.sql.gz
Schema: database/schema.sql
Individual tables: database/table_*.sql.gz
Metadata: database/table_metadata.txt
Indexes: database/indexes.txt
Foreign Keys: database/foreign_keys.txt

CODE
----
Server + Client: code/server.tar.gz
Flutter App: code/flutter_app.tar.gz (if exists)
React Native App: code/react_native_app.tar.gz (if exists)

RESTORE INSTRUCTIONS
--------------------
1. Database full restore:
   gunzip -c database/full_dump.sql.gz | psql \$DATABASE_URL

2. Single table restore:
   gunzip -c database/table_users.sql.gz | psql \$DATABASE_URL

3. Code restore:
   tar xzf code/server.tar.gz -C /path/to/project/

4. Schema only (no data):
   psql \$DATABASE_URL < database/schema.sql
EOF
echo "  ✓ Manifest created"

TOTAL_SIZE=$(du -sh "$BACKUP_BASE" | cut -f1)

echo ""
echo "============================================"
echo "  BACKUP COMPLETE"
echo "  Location: $BACKUP_BASE"
echo "  Size: $TOTAL_SIZE"
echo "  Tables: $TABLE_COUNT"
echo "============================================"

MAX_BACKUPS="${MAX_BACKUPS:-5}"
BACKUP_COUNT=$(ls -1d "${BACKUP_DIR}"/neuratalk_full_* 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  REMOVE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  echo ""
  echo "Removing $REMOVE_COUNT old backup(s) (keeping latest $MAX_BACKUPS)..."
  ls -1dt "${BACKUP_DIR}"/neuratalk_full_* | tail -n "$REMOVE_COUNT" | xargs rm -rf
fi
