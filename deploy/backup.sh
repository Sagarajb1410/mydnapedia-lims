#!/usr/bin/env bash
# Nightly: copy the database and files, then send them to the S3 bucket if one is set.
set -euo pipefail
set -a; . /etc/mydnapedia-lims.env; set +a
cd /opt/mydnapedia-lims
runuser -u lims -- env DATA_DIR="$DATA_DIR" node --no-warnings src/backup.js
if [ -n "${BACKUP_BUCKET:-}" ] && command -v aws >/dev/null; then
  aws s3 sync "$DATA_DIR/backups" "s3://$BACKUP_BUCKET/backups" --only-show-errors
  echo "$(date) sent to s3://$BACKUP_BUCKET"
fi
