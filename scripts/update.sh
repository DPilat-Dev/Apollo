#!/usr/bin/env bash
#
# Update Apollo in place. Run as root inside the container:
#
#   /opt/apollo/scripts/update.sh              latest release (default)
#   /opt/apollo/scripts/update.sh --edge       current main, unreleased
#   /opt/apollo/scripts/update.sh --ref v1.0.0 a specific tag or branch
#   /opt/apollo/scripts/update.sh --force      rebuild even if nothing changed
#   /opt/apollo/scripts/update.sh --build      build here instead of downloading
#   /opt/apollo/scripts/update.sh --service    reinstall the systemd unit only
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
SERVICE_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --edge)    REF="origin/main"; shift ;;
    --force)   FORCE=1; shift ;;
    # This script runs from a pinned copy of whatever version started, so the
    # release that first adds a unit-file change cannot apply it — the old copy
    # is driving. Afterwards the new one is on disk, and this asks it to do that
    # one thing without a rebuild and a second restart of everyone's stream.
    --service) SERVICE_ONLY=1; shift ;;
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
sync_unit() {
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
}

if [[ $SERVICE_ONLY -eq 1 ]]; then
  sync_unit
  systemctl restart "$SERVICE"
  ok "$SERVICE restarted"
  exit 0
fi


# Taken from the remote rather than hard-coded, so a fork updates from itself.
REPO=$(git config --get remote.origin.url 2>/dev/null \
  | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
REPO="${APOLLO_REPO:-${REPO:-DPilat-Dev/Apollo}}"

# How long to wait for a release artifact that has not appeared yet, in
# seconds. Zero restores the old behaviour of believing the first 404.
ARTIFACT_WAIT="${APOLLO_ARTIFACT_WAIT:-180}"

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
  # everyone's stream for nothing. Only skip if what is being served was built
  # from this commit — a previous run that died during the build must still be
  # recoverable.
  #
  # `-d dist` alone was not enough. A run that advanced the checkout and then
  # failed to build left git on the new commit and dist on the old one, and
  # this said there was nothing to do while serving the previous release. The
  # stamp is written only after a build or download has actually landed, so an
  # install that predates it rebuilds once and is correct from then on.
  if [[ $FORCE -eq 0 && "$(cat "$APP_DIR/dist/.apollo-build" 2>/dev/null)" == "$target" ]]; then
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

  # A release is published before its artifact is attached: the workflow that
  # builds it only starts when the release appears, and takes about half a
  # minute. v1.16.0 left a 29-second window — published at 20:42:03, artifact
  # at 20:42:32 — and an update inside it saw a real release carrying nothing.
  #
  # So a missing artifact is waited on before it is believed. The wait is
  # bounded and only costs anything when the artifact is genuinely absent,
  # which for a tag that was never released is the one case that still falls
  # through to building.
  local waited=0
  until curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" 2>/dev/null; do
    (( waited >= ARTIFACT_WAIT )) && return 1
    [[ $waited -eq 0 ]] && printf '%s\n' "  ${DIM}no artifact for $tag yet — the release workflow may still be running; waiting up to $((ARTIFACT_WAIT / 60))m${RESET}"
    sleep 15
    waited=$(( waited + 15 ))
  done
  (( waited > 0 )) && ok "artifact appeared after ${waited}s"
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

# What the Vite build needs, in MB. The workflow that produces the artifact
# says why this is not a number worth shaving: ~830 MB for the build and
# ~620 MB for the type check.
BUILD_NEEDS_MB=1024

build_here() {
  local avail
  avail=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0)

  # An automatic fallback must not take a path that ends in the OOM killer.
  # This container has ~250 MB of heap available and dies with "Ineffective
  # mark-compacts near heap limit" several seconds in, after the script has
  # already reported that it is updating — which looks like the update broke
  # rather than that it was never going to fit.
  if [[ $BUILD -eq 0 && $avail -gt 0 && $avail -lt $BUILD_NEEDS_MB ]]; then
    die "no prebuilt client for $REF, and this host has ${avail} MB free — the build needs about ${BUILD_NEEDS_MB} MB.
  If the release was just cut, its artifact lands about half a minute later: run this again.
  To build anyway, pass --build."
  fi

  printf '%s\n' "  ${DIM}building locally — this needs about ${BUILD_NEEDS_MB} MB of memory${RESET}"
  [[ $avail -gt 0 && $avail -lt $BUILD_NEEDS_MB ]] && printf '%s\n' "  ${RED}only ${avail} MB free; this may be killed${RESET}" >&2
  npm ci --silent
  npm run build
}

if [[ $BUILD -eq 1 ]]; then
  build_here
elif ! fetch_prebuilt "$REF"; then
  printf '%s\n' "  ${DIM}no prebuilt client for $REF; building instead${RESET}"
  build_here
fi

# Written last, and only here: this file is what the next run trusts when it
# decides whether there is anything to do. Anything that fails above exits
# before this line, which is the point — an unstamped dist is a dist nobody
# has promised anything about.
printf '%s\n' "$after" > "$APP_DIR/dist/.apollo-build"

sync_unit

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
