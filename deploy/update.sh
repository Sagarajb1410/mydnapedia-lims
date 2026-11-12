#!/usr/bin/env bash
# Installs a new LIMS version on the live server. Run from the new unzipped folder:
#   sudo bash deploy/update.sh
set -euo pipefail
APP=/opt/mydnapedia-lims
SRC="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo."; exit 1; fi
bash "$APP/deploy/backup.sh"
rsync -a --delete --exclude data "$SRC/" "$APP/" 2>/dev/null || { rm -rf "$APP.new"; cp -a "$SRC" "$APP.new"; rm -rf "$APP.new/data"; rm -rf "$APP"; mv "$APP.new" "$APP"; }
chown -R root:root "$APP"
systemctl restart mydnapedia-lims
sleep 2
systemctl --no-pager --lines=5 status mydnapedia-lims
