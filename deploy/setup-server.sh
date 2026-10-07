#!/usr/bin/env bash
# Sets up the live MyDNAPedia LIMS on a fresh Ubuntu 24.04 server (AWS Lightsail, Mumbai).
# Run from the unzipped LIMS folder:
#   sudo bash deploy/setup-server.sh lims.yourdomain.com admin@yourdomain.com [s3-backup-bucket-name]
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
BUCKET="${3:-}"
APP=/opt/mydnapedia-lims
DATA=/var/lib/mydnapedia-lims
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo."; exit 1; fi
if [ -z "$DOMAIN" ] || [ -z "$ADMIN_EMAIL" ]; then echo "Usage: sudo bash deploy/setup-server.sh lims.yourdomain.com admin@yourdomain.com [backup-bucket]"; exit 1; fi
if [ ! -f "$SRC/src/server.js" ]; then echo "Run this from inside the unzipped LIMS folder."; exit 1; fi

echo "== 1/6 System updates and tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw unattended-upgrades rsync

echo "== 2/6 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== 3/6 Caddy (https certificates are fetched and renewed automatically)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 4/6 The LIMS"
id lims >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin lims
mkdir -p "$APP" "$DATA"
cp -a "$SRC/." "$APP/"
rm -rf "$APP/data"
chown -R root:root "$APP"
chown -R lims:lims "$DATA"
chmod 700 "$DATA"
cat > /etc/mydnapedia-lims.env <<ENV
LIMS_STAGE=live
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA
STORAGE=local
BACKUP_BUCKET=$BUCKET
FIRST_ADMIN_EMAIL=$ADMIN_EMAIL
ENV
cp "$APP/deploy/mydnapedia-lims.service" /etc/systemd/system/mydnapedia-lims.service
systemctl daemon-reload
systemctl enable --now mydnapedia-lims

echo "== 5/6 Web address and firewall"
sed "s/{DOMAIN}/$DOMAIN/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== 6/6 Nightly backup at 01:30 India time"
timedatectl set-timezone Asia/Kolkata || true
cat > /etc/cron.d/mydnapedia-lims-backup <<CRON
30 1 * * * root bash $APP/deploy/backup.sh >> /var/log/mydnapedia-lims-backup.log 2>&1
CRON
if [ -n "$BUCKET" ] && ! command -v aws >/dev/null; then snap install aws-cli --classic; fi

sleep 3
echo
echo "Done. The LIMS is at https://$DOMAIN"
if [ -f "$DATA/FIRST-SIGN-IN.txt" ]; then echo; cat "$DATA/FIRST-SIGN-IN.txt"; fi
if [ -n "$BUCKET" ]; then echo; echo "For backups to S3, run: sudo aws configure   (paste the backup access key, region ap-south-1)"; fi
