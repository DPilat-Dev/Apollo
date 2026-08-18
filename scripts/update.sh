#!/usr/bin/env bash
#
# Update Apollo in place. Run as root inside the container:
#
#   /opt/apollo/scripts/update.sh              latest release (default)
#   /opt/apollo/scripts/update.sh --edge       current main, unreleased
#   /opt/apollo/scripts/update.sh --ref v1.0.0 a specific tag or branch
#   /opt/apollo/scripts/update.sh --force      rebuild even if nothing changed
#
# Releases by default, deliberately. A server people actually watch things on
# should not be following every commit on main: that includes work in progress
# and anything pushed between the moment a bug is introduced and the moment it
# is noticed. A tag is a point someone decided was fit to run.
#
# --edge is the escape hatch for a fix you need before you cut a version.
#
# Builds as root then hands ownership back, because the container has no sudo
# and the service account is a --system user with no login shell.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/apollo}"
SERVICE="${SERVICE:-apollo}"
OWNER="${OWNER:-apollo}"
REF="${APOLLO_REF:-}"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)    REF="origin/main"; shift ;;
    --force)   FORCE=1; shift ;;
    --ref)     REF="${2:-}"; [[ -n "$REF" ]] || { echo "--ref needs a value" >&2; exit 2; }; shift 2 ;;
    --ref=*)   REF="${1#--ref=}"; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

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
was=$(git describe --tags --exact-match 2>/dev/null || echo "$before")
printf '%s\n' "${BOLD}Updating $APP_DIR${RESET} ${DIM}(currently $was)${RESET}"

# --force because a tag that was moved would otherwise be kept at its old
# commit, and --prune-tags so a deleted release does not linger forever.
git fetch --quiet --tags --force --prune --prune-tags origin

if [[ -z "$REF" ]]; then
  # Highest version tag, not the most recently created one: a patch cut for an
  # older line after a newer release must not drag the server backwards.
  REF=$(git tag --list 'v*' --sort=-v:refname | head -n 1)
  [[ -n "$REF" ]] || die "No release tags found. Use --edge to follow main."
fi

git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null \
  || die "No such tag or branch: $REF"

target=$(git rev-parse --short "${REF}^{commit}")

if [[ "$before" == "$target" ]]; then
  ok "already on $REF ($target)"
  # Rebuilding and restarting for a version that is already running just drops
  # everyone's stream for nothing. Only skip if there is something to serve —
  # a previous run that died during the build must still be recoverable.
  if [[ $FORCE -eq 0 && -d "$APP_DIR/dist" ]]; then
    printf '%s\n' "  ${DIM}nothing to do — --force to rebuild anyway${RESET}"
    exit 0
  fi
else
  printf '%s\n' "  ${was} → ${BOLD}${REF}${RESET} ${DIM}(${target})${RESET}"
  git --no-pager log --oneline --no-decorate "${before}..${target}" 2>/dev/null | sed 's/^/    /' || true
  # Detached on purpose: a release is a fixed point, not a branch to follow.
  git -c advice.detachedHead=false checkout --quiet --detach "$target"
fi

after=$(git rev-parse --short HEAD)

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
  ok "$SERVICE restarted on ${REF} ($after)"
else
  printf '%s\n' "${RED}✗ $SERVICE did not come back. Recent log:${RESET}"
  journalctl -u "$SERVICE" -n 20 --no-pager
  exit 1
fi
