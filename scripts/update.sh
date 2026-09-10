#!/usr/bin/env bash
#
# Update Apollo in place. Run as root inside the container:
#
#   /opt/apollo/scripts/update.sh              latest release (default)
#   /opt/apollo/scripts/update.sh --edge       current main, unreleased
#   /opt/apollo/scripts/update.sh --ref v1.0.0 a specific tag or branch
#   /opt/apollo/scripts/update.sh --force      rebuild even if nothing changed
#   /opt/apollo/scripts/update.sh --build      build here instead of downloading
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

# Bash reads a script incrementally, by byte offset, while it runs. This script
# replaces itself — `git checkout` of a new tag rewrites `scripts/update.sh`
# underneath the running shell — and the next line bash reads then comes from
# whatever now sits at that offset in the new file. It has worked by luck.
#
# So: run from a private copy. The copy is the version that started, all the
# way through; the new one takes effect next time, which is the only ordering
# that can be reasoned about.
if [[ "${APOLLO_PINNED:-}" != 1 ]]; then
  _self=$(mktemp -t apollo-update.XXXXXX)
  cat "$0" > "$_self"
  chmod +x "$_self"
  # The copy removes itself; trapping here would fire before exec hands over.
  APOLLO_PINNED=1 APOLLO_SELF="$_self" exec "$_self" "$@"
fi
[[ -n "${APOLLO_SELF:-}" ]] && trap 'rm -f "$APOLLO_SELF"' EXIT

APP_DIR="${APP_DIR:-/opt/apollo}"
SERVICE="${SERVICE:-apollo}"
OWNER="${OWNER:-apollo}"
REF="${APOLLO_REF:-}"
FORCE=0
BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)    REF="origin/main"; shift ;;
    --force)   FORCE=1; shift ;;
    --build)   BUILD=1; shift ;;
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

# Taken from the remote rather than hard-coded, so a fork updates from itself.
REPO=$(git config --get remote.origin.url 2>/dev/null \
  | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
REPO="${APOLLO_REPO:-${REPO:-DPilat-Dev/Apollo}}"

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

# ── Getting a built client ────────────────────────────────────────────────
#
# Preferably by downloading one. Building needs ~830 MB of RSS for Vite and
# ~620 MB for the type check, and a container sized for serving files does not
# have it — the build dies with "JavaScript heap out of memory" on a host that
# runs the app perfectly well. The release carries the same artifact CI built
# and tested, so there is nothing host-specific to reproduce.
#
# `server/` imports only Node builtins, so nothing here needs node_modules.

fetch_prebuilt() {
  local tag="$1" tmp asset sum
  # Only a real release has an artifact. --edge is a branch, and a branch has
  # no release to carry one.
  [[ "$tag" == v* ]] || return 1

  asset="apollo-dist-${tag}.tar.gz"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # Overridable so this path can be exercised against a local server, and so a
  # deployment behind a mirror is not forced to build instead.
  local base="${APOLLO_RELEASE_BASE:-https://github.com/${REPO}/releases/download}/${tag}"
  curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || return 1
  curl -fsSL --retry 3 -o "$tmp/$asset.sha256" "$base/$asset.sha256" || return 1

  # The checksum is published beside the artifact, so it proves transfer
  # integrity rather than provenance. Both come from the same release over
  # TLS; this catches a truncated download, not a compromised one.
  ( cd "$tmp" && sha256sum --check --status "$asset.sha256" ) || {
    printf '%s\n' "  ${RED}checksum did not match — falling back to building${RESET}" >&2
    return 1
  }

  # Into place only once it has extracted cleanly: a half-unpacked dist over
  # the live one is a broken site with no way back.
  rm -rf "$tmp/unpack" && mkdir -p "$tmp/unpack"
  # --no-same-owner: root would otherwise restore whatever uid the archive
  # records, which is the build machine's and means nothing here. The chown at
  # the end of this script is what decides who owns these files.
  tar -xzf "$tmp/$asset" -C "$tmp/unpack" --no-same-owner || return 1
  [[ -f "$tmp/unpack/dist/index.html" ]] || return 1

  rm -rf "$APP_DIR/dist"
  mv "$tmp/unpack/dist" "$APP_DIR/dist"
  ok "downloaded the built client for $tag"
}

build_here() {
  printf '%s\n' "  ${DIM}building locally — this needs about 1 GB of memory${RESET}"
  npm ci --silent
  npm run build
}

if [[ $BUILD -eq 1 ]]; then
  build_here
elif ! fetch_prebuilt "$REF"; then
  printf '%s\n' "  ${DIM}no prebuilt client for $REF; building instead${RESET}"
  build_here
fi

# ── The unit file ─────────────────────────────────────────────────────────
#
# systemd reads its own copy under /etc/systemd/system, so a change to the one
# in this repo reaches nothing until it is installed again. That was fine while
# the unit never changed; it now carries an EnvironmentFile line without which
# the server cannot tell a browser where Jellyfin is, so an update that skipped
# it would fix nothing on an existing install.
#
# The port is whatever the installed unit already says — it is the one thing in
# there chosen per machine, and an update must not reset it.
UNIT=/etc/systemd/system/${SERVICE}.service
if [[ -f "$UNIT" && -f "$APP_DIR/apollo.service" ]]; then
  installed_port=$(sed -n 's/^Environment=PORT=\(.*\)$/\1/p' "$UNIT" | head -n 1)
  rendered=$(mktemp)
  if [[ -n "$installed_port" ]]; then
    sed "s/^Environment=PORT=.*/Environment=PORT=${installed_port}/" "$APP_DIR/apollo.service" > "$rendered"
  else
    cp "$APP_DIR/apollo.service" "$rendered"
  fi
  if ! cmp -s "$rendered" "$UNIT"; then
    cp "$rendered" "$UNIT"
    systemctl daemon-reload
    printf '%s\n' "  ${DIM}service definition updated${RESET}"
  fi
  rm -f "$rendered"
fi

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
