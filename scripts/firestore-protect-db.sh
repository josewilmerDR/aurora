#!/usr/bin/env bash
# Apply the baseline protection to a Firestore database: PITR, delete
# protection and a daily managed backup schedule (30-day retention).
#
# Idempotent — safe to run on day zero, as a periodic check, and (this is the
# reason it exists) right after promoting a RESTORED database: a restore comes
# up with PITR and delete protection OFF and no backup schedule (verified in
# the 2026-08-22 drill, see docs/firestore-backups.md §2.4).
#
# Usage:
#   scripts/firestore-protect-db.sh [DATABASE_ID] [PROJECT_ID]
# Defaults: auroradatabase / aurora-7dc9b
set -euo pipefail

DB="${1:-auroradatabase}"
PROJECT="${2:-aurora-7dc9b}"
RETENTION="30d"

echo "== $PROJECT / $DB"

echo "-- enabling PITR + delete protection (no-op if already on)"
gcloud firestore databases update \
  --database="$DB" --project="$PROJECT" \
  --enable-pitr --delete-protection >/dev/null

echo "-- daily backup schedule (retention $RETENTION)"
existing=$(gcloud firestore backups schedules list \
  --database="$DB" --project="$PROJECT" --format="value(name)" 2>/dev/null || true)
if [ -n "$existing" ]; then
  echo "   schedule already exists: ${existing##*/}"
else
  gcloud firestore backups schedules create \
    --database="$DB" --project="$PROJECT" \
    --recurrence=daily --retention="$RETENTION" >/dev/null
  echo "   schedule created"
fi

echo "-- verification"
gcloud firestore databases describe \
  --database="$DB" --project="$PROJECT" \
  --format="table[box](name.basename(),locationId,pointInTimeRecoveryEnablement,deleteProtectionState,versionRetentionPeriod)"
gcloud firestore backups schedules list \
  --database="$DB" --project="$PROJECT" \
  --format="yaml(name,dailyRecurrence,weeklyRecurrence,retention)"
