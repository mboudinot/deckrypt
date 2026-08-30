#!/usr/bin/env bash
#
# dev-remote.sh — sert l'app deckrypt et l'expose via un tunnel cloudflare,
# pour tester sur le téléphone (contournement obligatoire du NAT WSL2).
#
# Usage :
#   ./dev-remote.sh          # démarre serveur + tunnel, affiche l'URL HTTPS
#   ./dev-remote.sh stop     # coupe le tunnel (et le serveur lancé par ce script)
#   ./dev-remote.sh status   # état courant + URL si dispo
#
set -euo pipefail

PORT=8080
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SERVE_DIR="$SCRIPT_DIR"
CF="$REPO_ROOT/_scan-proto/cloudflared"
HTTP_BIN="$SCRIPT_DIR/node_modules/.bin/http-server"

TUNNEL_LOG=/tmp/deckrypt-tunnel.log
SERVER_LOG=/tmp/deckrypt-server.log
TUNNEL_PIDFILE=/tmp/deckrypt-tunnel.pid
SERVER_PIDFILE=/tmp/deckrypt-server.pid

server_up()  { curl -fsS -o /dev/null --max-time 2 "http://localhost:$PORT/index.html" 2>/dev/null; }
# `|| true` is load-bearing: an empty log makes grep exit 1, and under
# `set -euo pipefail` the `url="$(tunnel_url)"` assignment would then abort
# the whole script — which false-timed-out `start` on the first poll (before
# cloudflared writes the URL) and made `status` exit non-zero when down.
tunnel_url() { grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" 2>/dev/null | head -1 || true; }

start_server() {
  if server_up; then
    echo "• Serveur déjà actif sur http://localhost:$PORT (réutilisé)"
    return
  fi
  [ -x "$HTTP_BIN" ] || { echo "✗ http-server introuvable ($HTTP_BIN) — lance 'pnpm install'." >&2; exit 1; }
  ( cd "$SERVE_DIR" && nohup "$HTTP_BIN" -p "$PORT" -c-1 --silent >"$SERVER_LOG" 2>&1 & echo $! >"$SERVER_PIDFILE" )
  for _ in $(seq 1 15); do server_up && break; sleep 1; done
  server_up || { echo "✗ Le serveur n'a pas démarré — voir $SERVER_LOG" >&2; exit 1; }
  echo "• Serveur démarré sur http://localhost:$PORT"
}

start_tunnel() {
  [ -x "$CF" ] || { echo "✗ cloudflared introuvable ($CF)." >&2; exit 1; }
  # repart d'un tunnel propre pour éviter les doublons / vieilles URLs
  [ -f "$TUNNEL_PIDFILE" ] && kill "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null || true
  : >"$TUNNEL_LOG"
  nohup "$CF" tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
  echo $! >"$TUNNEL_PIDFILE"
  local url=""
  for _ in $(seq 1 45); do url="$(tunnel_url)"; [ -n "$url" ] && break; sleep 1; done
  [ -n "$url" ] || { echo "✗ Pas d'URL après 45 s — voir $TUNNEL_LOG" >&2; exit 1; }
  echo "• Tunnel actif"
  echo
  echo "  📱  $url"
  echo "      scanner caméra : $url/scan.html"
  echo
  echo "  (URL éphémère : elle change à chaque relance. ./dev-remote.sh stop pour couper.)"
}

cmd_stop() {
  local killed=0
  for f in "$TUNNEL_PIDFILE" "$SERVER_PIDFILE"; do
    if [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; then killed=1; fi
    rm -f "$f"
  done
  [ "$killed" = 1 ] && echo "• Tunnel/serveur coupés." || echo "• Rien à couper (pids inconnus de ce script)."
}

cmd_status() {
  server_up && echo "• Serveur : UP (http://localhost:$PORT)" || echo "• Serveur : down"
  local url; url="$(tunnel_url)"
  if [ -n "$url" ] && [ -f "$TUNNEL_PIDFILE" ] && kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
    echo "• Tunnel  : UP → $url"
  else
    echo "• Tunnel  : down"
  fi
}

case "${1:-start}" in
  start)  start_server; start_tunnel ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *) echo "Usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
