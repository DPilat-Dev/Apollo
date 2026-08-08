#!/usr/bin/env bash
#
# Update Apollo in place. Run as root inside the container:
#
#   /opt/apollo/scripts/update.sh
#
# Builds as root then hands ownership back, because the container has no sudo
# and the service account is a --system user with no login shell.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/apollo}"
SERVICE="${SERVICE:-apollo}"
OWNER="${OWNER:-apollo}"

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; GREEN=$'\e[32m'; RED=$'\e[31m'; DIM=$'\e[2m'; RESET=$'\e[0m'
else
  BOLD=''; GREEN=''; RED=''; DIM=''; RESET=''
fi
ok()  { printf '%s\n' "${GREEN}✓${RESET} $*"; }
die() { printf '%s\n' "${RED}✗ $*${RESET}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: the service is restarted at the end."
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout."

cd "$APP_DIR"

# The checkout is owned by the service account, so git refuses to touch it as
# root until told this is deliberate.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

before=$(git rev-parse --short HEAD)
printf '%s\n' "${BOLD}Updating $APP_DIR${RESET} ${DIM}(currently $before)${RESET}"

git pull --ff-only
after=$(git rev-parse --short HEAD)

if [[ "$before" == "$after" ]]; then
  ok "already up to date ($after)"
else
  printf '%s\n' "  ${before} → ${BOLD}${after}${RESET}"
  git --no-pager log --oneline "${before}..${after}" | sed 's/^/    /'
fi

npm ci --silent
npm run build

# Local configuration must survive an update.
for f in .env apollo.runtime.json; do
  [[ -e "$f" ]] && printf '%s\n' "  ${DIM}kept $f${RESET}"
done

chown -R "$OWNER:$OWNER" "$APP_DIR"
systemctl restart "$SERVICE"
sleep 2

if systemctl is-active --quiet "$SERVICE"; then
  ok "$SERVICE restarted on $after"
else
  printf '%s\n' "${RED}✗ $SERVICE did not come back. Recent log:${RESET}"
  journalctl -u "$SERVICE" -n 20 --no-pager
  exit 1
fi
