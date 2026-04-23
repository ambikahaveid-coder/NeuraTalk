#!/bin/bash
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable is not set."
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"

show_help() {
  echo "============================================"
  echo "  NeuraTalk Database Restore Tool"
  echo "============================================"
  echo ""
  echo "Usage:"
  echo "  ./scripts/restore.sh full <backup_folder>        Restore entire database"
  echo "  ./scripts/restore.sh table <table_name> <folder> Restore single table"
  echo "  ./scripts/restore.sh schema <backup_folder>      Restore schema only (no data)"
  echo "  ./scripts/restore.sh list                        List available backups"
  echo "  ./scripts/restore.sh verify <backup_folder>      Verify backup integrity"
  echo ""
  echo "Examples:"
  echo "  ./scripts/restore.sh list"
  echo "  ./scripts/restore.sh full ./backups/neuratalk_full_20260225_120000"
  echo "  ./scripts/restore.sh table users ./backups/neuratalk_full_20260225_120000"
  echo "  ./scripts/restore.sh schema ./backups/neuratalk_full_20260225_120000"
}

list_backups() {
  echo "Available backups in $BACKUP_DIR:"
  echo ""
  if ls -1d "${BACKUP_DIR}"/neuratalk_full_* 1>/dev/null 2>&1; then
    for dir in $(ls -1dt "${BACKUP_DIR}"/neuratalk_full_*); do
      SIZE=$(du -sh "$dir" | cut -f1)
      TABLES=$(ls "$dir/database"/table_*.sql.gz 2>/dev/null | wc -l)
      MANIFEST=""
      if [ -f "$dir/BACKUP_MANIFEST.txt" ]; then
        MANIFEST=" [manifest OK]"
      fi
      echo "  $dir ($SIZE, $TABLES tables)${MANIFEST}"
    done
  else
    echo "  No backups found."
  fi
}

verify_backup() {
  local FOLDER="$1"
  echo "Verifying backup: $FOLDER"
  echo ""
  
  local ERRORS=0
  
  if [ ! -d "$FOLDER" ]; then
    echo "  ✗ Backup folder not found"
    exit 1
  fi
  
  if [ -f "$FOLDER/database/full_dump.sql.gz" ]; then
    SIZE=$(du -h "$FOLDER/database/full_dump.sql.gz" | cut -f1)
    echo "  ✓ Full dump: $SIZE"
  else
    echo "  ✗ Full dump missing!"
    ERRORS=$((ERRORS + 1))
  fi
  
  if [ -f "$FOLDER/database/schema.sql" ]; then
    TABLES=$(grep -c "CREATE TABLE" "$FOLDER/database/schema.sql" 2>/dev/null || echo "0")
    echo "  ✓ Schema: $TABLES tables defined"
  else
    echo "  ✗ Schema file missing!"
    ERRORS=$((ERRORS + 1))
  fi
  
  TABLE_FILES=$(ls "$FOLDER/database"/table_*.sql.gz 2>/dev/null | wc -l)
  echo "  ✓ Individual table backups: $TABLE_FILES"
  
  if [ -f "$FOLDER/code/server.tar.gz" ]; then
    SIZE=$(du -h "$FOLDER/code/server.tar.gz" | cut -f1)
    echo "  ✓ Code archive: $SIZE"
  else
    echo "  ⚠ Code archive missing (optional)"
  fi
  
  if [ -f "$FOLDER/BACKUP_MANIFEST.txt" ]; then
    echo "  ✓ Manifest present"
  else
    echo "  ⚠ No manifest"
  fi
  
  echo ""
  if [ $ERRORS -eq 0 ]; then
    echo "  Backup is VALID"
  else
    echo "  Backup has $ERRORS error(s)"
  fi
}

restore_full() {
  local FOLDER="$1"
  
  if [ ! -f "$FOLDER/database/full_dump.sql.gz" ]; then
    echo "ERROR: Full dump not found at $FOLDER/database/full_dump.sql.gz"
    exit 1
  fi
  
  echo "WARNING: This will REPLACE ALL DATA in the current database."
  echo "Backup: $FOLDER"
  echo ""
  read -p "Type 'yes' to confirm: " CONFIRM
  
  if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
  fi
  
  echo ""
  echo "Creating safety backup before restore..."
  SAFETY_BACKUP="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
  pg_dump "$DATABASE_URL" --no-owner --no-acl 2>/dev/null | gzip > "$SAFETY_BACKUP"
  echo "  Safety backup: $SAFETY_BACKUP"
  
  echo ""
  echo "Restoring database..."
  gunzip -c "$FOLDER/database/full_dump.sql.gz" | psql "$DATABASE_URL" --quiet 2>/dev/null
  
  echo ""
  echo "✓ Database restored successfully from: $FOLDER"
  echo "  Safety backup saved at: $SAFETY_BACKUP"
}

restore_table() {
  local TABLE="$1"
  local FOLDER="$2"
  local TABLE_FILE="$FOLDER/database/table_${TABLE}.sql.gz"
  
  if [ ! -f "$TABLE_FILE" ]; then
    echo "ERROR: Table backup not found: $TABLE_FILE"
    echo ""
    echo "Available tables:"
    ls "$FOLDER/database"/table_*.sql.gz 2>/dev/null | sed 's/.*table_//;s/.sql.gz//' | while read t; do
      echo "  $t"
    done
    exit 1
  fi
  
  echo "Restoring table '$TABLE' from $FOLDER"
  read -p "This will REPLACE data in table '$TABLE'. Continue? (yes/no): " CONFIRM
  
  if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
  
  gunzip -c "$TABLE_FILE" | psql "$DATABASE_URL" --quiet 2>/dev/null
  echo "✓ Table '$TABLE' restored."
}

restore_schema() {
  local FOLDER="$1"
  
  if [ ! -f "$FOLDER/database/schema.sql" ]; then
    echo "ERROR: Schema file not found."
    exit 1
  fi
  
  echo "Restoring schema only (no data) from $FOLDER"
  read -p "Continue? (yes/no): " CONFIRM
  
  if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
  
  psql "$DATABASE_URL" --quiet < "$FOLDER/database/schema.sql" 2>/dev/null
  echo "✓ Schema restored."
}

case "${1:-help}" in
  full)
    [ -z "${2:-}" ] && { echo "ERROR: Specify backup folder"; show_help; exit 1; }
    restore_full "$2"
    ;;
  table)
    [ -z "${2:-}" ] || [ -z "${3:-}" ] && { echo "ERROR: Specify table name and backup folder"; show_help; exit 1; }
    restore_table "$2" "$3"
    ;;
  schema)
    [ -z "${2:-}" ] && { echo "ERROR: Specify backup folder"; show_help; exit 1; }
    restore_schema "$2"
    ;;
  list)
    list_backups
    ;;
  verify)
    [ -z "${2:-}" ] && { echo "ERROR: Specify backup folder"; show_help; exit 1; }
    verify_backup "$2"
    ;;
  *)
    show_help
    ;;
esac
