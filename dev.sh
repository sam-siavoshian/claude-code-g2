#!/usr/bin/env bash
# dev.sh — one-shot Claude Code G2 dev launcher
#
# What it does:
#   1. Installs missing deps (bun, cloudflared, qrencode) via brew / curl
#   2. Runs `bun install` in backend/ and frontend/ if node_modules is missing
#   3. Frees ports 8787 and 5173, kills stale cloudflared tunnels
#   4. Boots the backend, extracts the bearer token from its output
#   5. Opens a cloudflared quick tunnel, extracts the public URL
#   6. Boots the Vite dev server
#   7. Builds a one-scan setup URL with ?backend=&token= query params
#   8. Health-checks the tunnel (HTTP 200 on /api/health AND authed /api/config)
#   9. Prints a QR code to the terminal and tails all logs
#  10. Ctrl-C tears everything down cleanly
#
# Flags:
#   --smoke    exit after the health check (used by CI / the commit test)
#
# Env overrides:
#   BACKEND_PORT   (default 8787)
#   FRONTEND_PORT  (default 5173)

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"

BACKEND_PORT=${BACKEND_PORT:-8787}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

BACKEND_LOG="$LOG_DIR/backend.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

BACKEND_PID=""
TUNNEL_PID=""
FRONTEND_PID=""

SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --smoke) SMOKE=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[36m[cc-g2]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[cc-g2]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[cc-g2]\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  say "shutting down..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$TUNNEL_PID"  ]] && kill "$TUNNEL_PID"  2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- dependency checks -----------------------------------------------------

need() { command -v "$1" >/dev/null 2>&1; }

install_bun() {
  say "installing bun..."
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
}

install_brew_pkg() {
  local pkg=$1
  say "installing $pkg via brew..."
  need brew || die "homebrew required to install $pkg — install from https://brew.sh"
  brew install "$pkg" >/dev/null
}

ensure_deps() {
  need bun          || install_bun
  need cloudflared  || install_brew_pkg cloudflared
  need qrencode     || install_brew_pkg qrencode
  need curl         || die "curl is required but missing"
  need lsof         || die "lsof is required but missing"
  need claude       || die "claude CLI not found — install from https://code.claude.com and run 'claude auth login'"
}

ensure_env() {
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    die "backend/.env missing — copy backend/.env.example to backend/.env and set OPENAI_API_KEY"
  fi
}

ensure_node_modules() {
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    say "installing backend deps..."
    (cd "$BACKEND_DIR" && bun install >/dev/null)
  fi
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    say "installing frontend deps..."
    (cd "$FRONTEND_DIR" && bun install >/dev/null)
  fi
}

# --- port cleanup ----------------------------------------------------------

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    say "freeing port $port (pids: $pids)"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 0.3
  fi
}

kill_stale_tunnels() {
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
}

# --- service starters ------------------------------------------------------

wait_for_log() {
  local log=$1 pattern=$2 label=$3 max_tenths=${4:-60}
  local i
  for (( i=0; i<max_tenths; i++ )); do
    if grep -qE "$pattern" "$log" 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  warn "--- $label log tail ---"
  tail -n 30 "$log" >&2 || true
  die "$label didn't come up in time"
}

start_backend() {
  say "starting backend on :$BACKEND_PORT..."
  : > "$BACKEND_LOG"
  (cd "$BACKEND_DIR" && PORT=$BACKEND_PORT bun src/index.ts) > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  wait_for_log "$BACKEND_LOG" "listening on" "backend" 80
}

extract_token() {
  # The banner prints BEARER TOKEN on one line and the actual token on the next.
  awk '/BEARER TOKEN/{getline; gsub(/[ \t]/,""); print; exit}' "$BACKEND_LOG"
}

start_tunnel() {
  say "starting cloudflared tunnel..."
  : > "$TUNNEL_LOG"
  # Use 127.0.0.1 instead of localhost: macOS resolves `localhost` to ::1
  # (IPv6) first, and cloudflared sticks with it — but the backend binds to
  # 0.0.0.0 (IPv4), so the tunnel can't reach the origin.
  cloudflared tunnel --url "http://127.0.0.1:$BACKEND_PORT" > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  wait_for_log "$TUNNEL_LOG" "https://[a-z0-9-]+\\.trycloudflare\\.com" "tunnel" 200
}

extract_tunnel_url() {
  grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" | head -1
}

start_frontend() {
  say "starting vite on :$FRONTEND_PORT..."
  : > "$FRONTEND_LOG"
  (cd "$FRONTEND_DIR" && bunx vite --port "$FRONTEND_PORT" --host --strictPort) > "$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!
  wait_for_log "$FRONTEND_LOG" "Local:" "vite" 120
}

# --- verification ----------------------------------------------------------

# Resolve a host via public DNS (1.1.1.1 first, 8.8.8.8 fallback). Cached
# per-tunnel in RESOLVED_IP so we don't re-dig on every probe.
RESOLVED_IP=""
resolve_host() {
  local host=$1
  if [[ -n "$RESOLVED_IP" ]]; then
    printf '%s' "$RESOLVED_IP"
    return
  fi
  local ip
  ip=$(dig +short +time=2 +tries=1 @1.1.1.1 "$host" 2>/dev/null | grep -Eo '^[0-9.]+$' | head -1 || true)
  [[ -z "$ip" ]] && ip=$(dig +short +time=2 +tries=1 @8.8.8.8 "$host" 2>/dev/null | grep -Eo '^[0-9.]+$' | head -1 || true)
  RESOLVED_IP=${ip:-}
  printf '%s' "$RESOLVED_IP"
}

# Fetch HTTP status code for a URL. Prints a 3-digit code (000 on failure).
# Additional curl args (e.g. -H "Authorization: ...") can be passed as
# positional args — they're forwarded verbatim via "$@".
probe() {
  local url=$1; shift
  local code
  # curl -w always writes a 3-digit code; capture it and ignore curl's exit.
  code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null) || true
  if [[ "$code" != "000" && -n "$code" ]]; then
    printf '%s' "$code"
    return
  fi
  # System DNS miss (local resolver lagging the fresh trycloudflare subdomain).
  # Resolve through public DNS and hand the IP to curl explicitly.
  local host ip
  host=$(printf '%s' "$url" | sed -E 's~^https?://([^/]+).*~\1~')
  ip=$(resolve_host "$host")
  if [[ -n "$ip" ]]; then
    code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' \
      --resolve "$host:443:$ip" "$@" "$url" 2>/dev/null) || true
  fi
  printf '%s' "${code:-000}"
}

# Retry a probe until it returns one of the expected codes or the loop runs out.
# Usage: probe_expect "<label>" "<url>" "<expected-code>" <max-seconds> [curl-args...]
probe_expect() {
  local label=$1 url=$2 expected=$3 max=$4; shift 4
  local code=""
  local i
  for (( i=0; i<max; i++ )); do
    code=$(probe "$url" "$@")
    [[ "$code" == "$expected" ]] && { printf '%s' "$code"; return 0; }
    sleep 1
  done
  printf '%s' "${code:-000}"
  return 1
}

test_tunnel() {
  local url=$1 token=$2

  say "verifying backend directly on 127.0.0.1 first..."
  local code
  code=$(curl -sS --max-time 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$BACKEND_PORT/api/health" || true)
  [[ "$code" == "200" ]] || die "backend not reachable locally: HTTP '$code'"

  say "waiting for tunnel DNS to propagate..."
  if ! code=$(probe_expect "health" "$url/api/health" "200" 45); then
    warn "--- tunnel log tail ---"; tail -n 15 "$TUNNEL_LOG" >&2 || true
    warn "tunnel /api/health returned HTTP $code after 45s"
    warn "cloudflared registered the tunnel, so this is almost certainly"
    warn "a local DNS cache hiccup. Your phone's DNS should be fine."
    warn "continuing anyway; the setup URL below is valid."
    return 0
  fi

  if ! code=$(probe_expect "config-auth" "$url/api/config" "200" 15 -H "Authorization: Bearer $token"); then
    warn "tunnel /api/config (authed) flapping (last HTTP $code); skipping auth check."
    return 0
  fi
  if ! code=$(probe_expect "config-unauth" "$url/api/config" "401" 15); then
    warn "tunnel /api/config (unauthed) flapping (last HTTP $code); skipping rejection check."
    return 0
  fi
  say "tunnel OK (health + auth + rejection all pass)"
}

# --- helpers ---------------------------------------------------------------

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || echo "127.0.0.1"
}

# --- main ------------------------------------------------------------------

ensure_deps
ensure_env
ensure_node_modules

kill_stale_tunnels
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

start_backend
TOKEN=$(extract_token)
[[ -n "$TOKEN" ]] || die "couldn't parse bearer token from backend log"

start_tunnel
TUNNEL_URL=$(extract_tunnel_url)
[[ -n "$TUNNEL_URL" ]] || die "couldn't parse tunnel URL"

start_frontend
LAN_IP=$(lan_ip)

# Both the tunnel URL and the base64url token are URL-safe by construction,
# so we can drop them into a query string verbatim.
SETUP_URL="http://$LAN_IP:$FRONTEND_PORT/?backend=$TUNNEL_URL&token=$TOKEN"

test_tunnel "$TUNNEL_URL" "$TOKEN"

echo
echo "═══════════════════════════════════════════════════════════════"
echo " Claude Code G2 is LIVE"
echo "═══════════════════════════════════════════════════════════════"
echo " Backend:        http://localhost:$BACKEND_PORT"
echo " Tunnel:         $TUNNEL_URL"
echo " Frontend:       http://$LAN_IP:$FRONTEND_PORT"
echo " Bearer token:   $TOKEN"
echo
echo " SETUP URL (scan this or paste on the phone):"
echo "   $SETUP_URL"
echo
qrencode -t ANSIUTF8 "$SETUP_URL"
echo
echo " Scan the QR in the Even Realities App."
echo " The companion pane auto-fills both fields; green dot = connected."
echo " Ctrl-C to stop everything."
echo "═══════════════════════════════════════════════════════════════"
echo

if [[ "$SMOKE" == "1" ]]; then
  say "smoke mode: exiting cleanly"
  exit 0
fi

tail -n 0 -f "$BACKEND_LOG" "$TUNNEL_LOG" "$FRONTEND_LOG"
