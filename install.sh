#!/usr/bin/env bash
# install.sh — Buttercloud interactive installer
# Sets up the app, generates .env, installs dependencies, builds the frontend,
# initialises the database, and registers a systemd service.
# Must be run as root (or with sudo) so it can write to /etc/systemd/system/.

set -euo pipefail

# ─── colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✔ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()     { echo -e "${RED}✖ $*${RESET}" >&2; exit 1; }

# ─── banner ──────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ██████╗ ██╗   ██╗████████╗████████╗███████╗██████╗"
echo "  ██╔══██╗██║   ██║╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗"
echo "  ██████╔╝██║   ██║   ██║      ██║   █████╗  ██████╔╝"
echo "  ██╔══██╗██║   ██║   ██║      ██║   ██╔══╝  ██╔══██╗"
echo "  ██████╔╝╚██████╔╝   ██║      ██║   ███████╗██║  ██║"
echo "  ╚═════╝  ╚═════╝    ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝"
echo -e "  ${RESET}${CYAN}Cloud Storage Platform — Installer${RESET}"
echo ""

# ─── root check ──────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root or with sudo: sudo ./install.sh"

# ─── prerequisites ───────────────────────────────────────────────────────────
info "Checking prerequisites…"
for cmd in node npm git; do
  command -v "$cmd" &>/dev/null || die "$cmd is not installed. Please install it first."
done

NODE_VERSION=$(node -e "process.exit(parseInt(process.version.slice(1)) < 20 ? 1 : 0)" 2>/dev/null && echo ok || echo fail)
[[ "$NODE_VERSION" == "fail" ]] && die "Node.js 20+ required. Current: $(node --version)"

success "Prerequisites OK (Node $(node --version), npm $(npm --version))"

# ─── install directory ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/package.json" ]] || die "Run this script from the Buttercloud repo root."
INSTALL_DIR="$SCRIPT_DIR"
INSTALL_USER="${SUDO_USER:-$(whoami)}"
NODE_BIN="$(command -v node)"

# ─── port detection ──────────────────────────────────────────────────────────
find_free_port() {
  local port=$1
  while ss -tlnp 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"; do
    port=$((port + 1))
  done
  echo "$port"
}

DETECTED_PORT=$(find_free_port 3000)

# ─── helpers ─────────────────────────────────────────────────────────────────
prompt() {
  # prompt <var_name> <label> [default]
  local var="$1" label="$2" default="${3:-}"
  local hint=""
  [[ -n "$default" ]] && hint=" [${default}]"
  echo -ne "${BOLD}${label}${RESET}${hint}: "
  read -r value
  [[ -z "$value" ]] && value="$default"
  printf -v "$var" '%s' "$value"
}

prompt_secret() {
  local var="$1" label="$2" default="${3:-}"
  local hint=""
  [[ -n "$default" ]] && hint=" [${default}]"
  echo -ne "${BOLD}${label}${RESET}${hint}: "
  read -rs value; echo ""
  [[ -z "$value" ]] && value="$default"
  printf -v "$var" '%s' "$value"
}

prompt_optional() {
  local var="$1" label="$2"
  echo -ne "${BOLD}${label}${RESET} (leave blank to skip): "
  read -r value
  printf -v "$var" '%s' "$value"
}

# ─── interactive config ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━  Required Configuration  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

prompt         APP_URL       "Public URL (e.g. https://storage.example.com)" "http://localhost:${DETECTED_PORT}"
prompt         PORT          "Backend port" "$DETECTED_PORT"
prompt         MONGODB_URI   "MongoDB URI" "mongodb://localhost:27017/buttercloud"
prompt         MONGODB_DB    "MongoDB database name" "buttercloud"
prompt         MINIO_ENDPOINT "MinIO internal endpoint (e.g. http://localhost:9000)" "http://localhost:9000"
prompt         MINIO_USER    "MinIO root user" "minioadmin"
prompt_secret  MINIO_PASS    "MinIO root password" "minioadmin"

echo ""
echo -e "${BOLD}━━━  Security  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
GENERATED_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
echo -e "  ${CYAN}Auto-generated JWT secret:${RESET} ${GENERATED_SECRET}"
echo -ne "${BOLD}JWT secret${RESET} (press Enter to use generated): "
read -rs JWT_SECRET; echo ""
[[ -z "$JWT_SECRET" ]] && JWT_SECRET="$GENERATED_SECRET"

echo ""
echo -e "${BOLD}━━━  Email / SMTP  (optional — skip for no email)  ━━━━━━━━━━━━━${RESET}"
echo ""
warn "Without SMTP, password reset and invoice emails will be disabled."
echo -ne "${BOLD}Configure email now?${RESET} [y/N]: "
read -r SETUP_SMTP

SMTP_HOST="" SMTP_PORT="465" SMTP_USER="" SMTP_PASS="" SMTP_FROM=""
if [[ "$SETUP_SMTP" =~ ^[Yy]$ ]]; then
  prompt        SMTP_HOST "SMTP host (e.g. smtp.resend.com)" "smtp.resend.com"
  prompt        SMTP_PORT "SMTP port" "465"
  prompt        SMTP_USER "SMTP username" "resend"
  prompt_secret SMTP_PASS "SMTP password"
  prompt        SMTP_FROM "From address" "billing@yourdomain.com"
fi

echo ""
echo -e "${BOLD}━━━  HIVE Payments  (optional)  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
prompt_optional HIVE_ACCOUNT "HIVE account username (without @)"

# ─── write .env ──────────────────────────────────────────────────────────────
echo ""
info "Writing .env…"

cat > "$INSTALL_DIR/.env" <<ENVFILE
# Generated by install.sh on $(date -u +"%Y-%m-%d %H:%M UTC")

# Server
NODE_ENV=production
PORT=${PORT}
HOST=0.0.0.0
APP_URL=${APP_URL}

# MongoDB
MONGODB_URI=${MONGODB_URI}
MONGODB_DB_NAME=${MONGODB_DB}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=604800

# MinIO
MINIO_INTERNAL_ENDPOINT=${MINIO_ENDPOINT}
MINIO_ROOT_USER=${MINIO_USER}
MINIO_ROOT_PASSWORD=${MINIO_PASS}

# API Keys & Security
API_KEY_HASH_ROUNDS=10
PASSWORD_HASH_ROUNDS=10
MAX_API_KEYS_PER_USER=10
MAX_BUCKETS_PER_USER=1

# Rate Limiting
RATE_LIMIT_WINDOW_MS=1000
RATE_LIMIT_MAX_REQUESTS=100

# Email / SMTP
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}

# HIVE Payments
HIVE_ACCOUNT=${HIVE_ACCOUNT}

# Logging
LOG_LEVEL=info

# CORS
CORS_ORIGIN=*
ENVFILE

chown "$INSTALL_USER:$INSTALL_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"
success ".env written (permissions: 600)"

# ─── fix ownership so npm can write node_modules ─────────────────────────────
info "Setting directory ownership to ${INSTALL_USER}…"
chown -R "$INSTALL_USER:$INSTALL_USER" "$INSTALL_DIR"
success "Ownership set"

# ─── install dependencies ─────────────────────────────────────────────────────
echo ""
info "Installing backend dependencies…"
cd "$INSTALL_DIR"
sudo -u "$INSTALL_USER" npm install --omit=dev
success "Backend dependencies installed"

info "Installing frontend dependencies and building…"
cd "$INSTALL_DIR/frontend"
sudo -u "$INSTALL_USER" npm install
sudo -u "$INSTALL_USER" npm run build
cd "$INSTALL_DIR"
success "Frontend built → frontend/dist/"

# ─── initialise database ─────────────────────────────────────────────────────
echo ""
info "Initialising database (indexes + plan quotas)…"
sudo -u "$INSTALL_USER" node scripts/setup-db.js \
  && success "Database initialised" \
  || warn "DB init failed — check your MONGODB_URI and try: node scripts/setup-db.js"

# ─── systemd service ─────────────────────────────────────────────────────────
echo ""
info "Creating systemd service (buttercloud)…"

cat > /etc/systemd/system/buttercloud.service <<UNIT
[Unit]
Description=Buttercloud S3 Storage Platform
Documentation=https://github.com/Mantequilla-Soft/buttercloud
After=network.target

[Service]
Type=simple
User=${INSTALL_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=buttercloud

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable buttercloud
systemctl start buttercloud
sleep 2

# ─── result ──────────────────────────────────────────────────────────────────
echo ""
if systemctl is-active --quiet buttercloud; then
  success "Buttercloud is running!"
else
  warn "Service started but may not be healthy. Check: journalctl -u buttercloud -n 50"
fi

echo ""
echo -e "${BOLD}━━━  Installation complete  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  App URL   : ${CYAN}${APP_URL}${RESET}"
echo -e "  Port      : ${CYAN}${PORT}${RESET}"
echo -e "  Service   : ${CYAN}buttercloud${RESET}"
echo -e "  Logs      : ${CYAN}journalctl -u buttercloud -f${RESET}"
echo -e "  Config    : ${CYAN}${INSTALL_DIR}/.env${RESET}"
echo ""
echo -e "  Next step : ${BOLD}register your first storage node, then promote yourself to admin${RESET}"
echo -e "  See       : ${CYAN}README.md${RESET} → Getting Started"
echo ""
