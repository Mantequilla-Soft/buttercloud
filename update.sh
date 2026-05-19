#!/usr/bin/env bash
# update.sh — Pull latest Buttercloud code and restart the service.
# Run as root (or sudo) so it can restart the systemd service.

set -euo pipefail

# ─── colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✔ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()     { echo -e "${RED}✖ $*${RESET}" >&2; exit 1; }

# ─── checks ──────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root or with sudo: sudo ./update.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/package.json" ]] || die "Run this script from the Buttercloud repo root."

SERVICE="buttercloud"
INSTALL_USER="${SUDO_USER:-$(whoami)}"

systemctl list-unit-files "${SERVICE}.service" &>/dev/null \
  || die "Service '${SERVICE}' not found. Run install.sh first."

# ─── current version ─────────────────────────────────────────────────────────
cd "$SCRIPT_DIR"
BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo ""
echo -e "${BOLD}Buttercloud — Update${RESET}"
echo -e "  Current commit : ${CYAN}${BEFORE}${RESET}"
echo ""

# ─── pull latest ─────────────────────────────────────────────────────────────
info "Pulling latest code from GitHub…"
sudo -u "$INSTALL_USER" git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [[ "$LOCAL" == "$REMOTE" ]]; then
  success "Already up to date — nothing to do."
  echo ""
  systemctl status "$SERVICE" --no-pager -l | head -20
  exit 0
fi

sudo -u "$INSTALL_USER" git pull --ff-only origin main
AFTER=$(git rev-parse --short HEAD)
success "Updated ${BEFORE} → ${AFTER}"

# ─── show what changed ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Changes:${RESET}"
git log --oneline "${BEFORE}..HEAD" | sed 's/^/  /'
echo ""

# ─── dependencies ────────────────────────────────────────────────────────────
info "Updating backend dependencies…"
sudo -u "$INSTALL_USER" npm install --omit=dev 2>&1 | tail -3
success "Backend dependencies up to date"

info "Rebuilding frontend…"
sudo -u "$INSTALL_USER" npm run build:frontend 2>&1 | tail -5
success "Frontend rebuilt → frontend/dist/"

# ─── database migrations (idempotent) ────────────────────────────────────────
info "Running database setup (idempotent — safe to re-run)…"
sudo -u "$INSTALL_USER" node scripts/setup-db.js \
  && success "Database up to date" \
  || warn "DB setup returned a non-zero exit — check manually if needed"

# ─── restart service ─────────────────────────────────────────────────────────
info "Restarting ${SERVICE}…"
systemctl restart "$SERVICE"
sleep 2

# ─── result ──────────────────────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE"; then
  success "Service is running"
else
  warn "Service may not be healthy. Check: journalctl -u ${SERVICE} -n 50"
fi

echo ""
systemctl status "$SERVICE" --no-pager -l | head -15
echo ""
echo -e "  Logs : ${CYAN}journalctl -u ${SERVICE} -f${RESET}"
echo ""
