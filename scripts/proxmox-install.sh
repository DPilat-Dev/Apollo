#!/usr/bin/env bash
#
# Apollo — Proxmox LXC installer
#
# Run this ON THE PROXMOX HOST (not inside a container):
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/DPilat-Dev/Apollo/main/scripts/proxmox-install.sh)"
#
# Creates an unprivileged Debian container, installs Node and Apollo, and starts
# it under systemd. Every prompt has a default; press Enter to accept it.
#
# Non-interactive: set the same names as environment variables and pass --yes.
#   CTID=120 JELLYFIN_URL=https://jellyfin.example.com ./proxmox-install.sh --yes
#
set -euo pipefail

# ---------------------------------------------------------------- appearance

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'
  YELLOW=$'\e[33m'; BLUE=$'\e[36m'; RESET=$'\e[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

info()  { printf '%s\n' "${BLUE}::${RESET} $*"; }
ok()    { printf '%s\n' "${GREEN}✓${RESET}  $*"; }
warn()  { printf '%s\n' "${YELLOW}!${RESET}  $*"; }
die()   { printf '%s\n' "${RED}✗  $*${RESET}" >&2; exit 1; }
step()  { printf '\n%s\n' "${BOLD}$*${RESET}"; }

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

# ------------------------------------------------------------------- guards

[[ $EUID -eq 0 ]] || die "Run as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || die "pct not found — run this on the Proxmox host, not inside a container."

# --------------------------------------------------------------- prompting

ask() {
  # ask VAR "Question" "default"
  local var="$1" question="$2" default="${3-}" current reply
  current="${!var-}"
  if [[ -n "$current" ]]; then
    printf '%s\n' "  ${question}: ${BOLD}${current}${RESET} ${DIM}(from environment)${RESET}"
    return
  fi
  if (( ASSUME_YES )); then
    printf -v "$var" '%s' "$default"
    printf '%s\n' "  ${question}: ${BOLD}${default}${RESET}"
    return
  fi
  read -r -p "  ${question} [${default}]: " reply || true
  printf -v "$var" '%s' "${reply:-$default}"
}

ask_yes_no() {
  # ask_yes_no VAR "Question" "yes|no"
  local var="$1" question="$2" default="$3" reply
  if [[ -n "${!var-}" ]]; then return; fi
  if (( ASSUME_YES )); then printf -v "$var" '%s' "$default"; return; fi
  read -r -p "  ${question} [${default}]: " reply || true
  reply="${reply:-$default}"
  case "${reply,,}" in y|yes|true|1) printf -v "$var" 'yes' ;; *) printf -v "$var" 'no' ;; esac
}

# ------------------------------------------------------------- gather input

step "Apollo — Proxmox LXC installer"
printf '%s\n' "${DIM}A modern web client for Jellyfin. Press Enter to accept each default.${RESET}"

# Next free container id, so the default is always usable.
next_ctid=$(pvesh get /cluster/nextid 2>/dev/null || echo 120)

step "Container"
ask CTID       "Container ID"        "$next_ctid"
ask CT_HOSTNAME "Hostname"           "apollo"
ask CORES      "CPU cores"           "1"
ask RAM        "Memory (MB)"         "512"
ask DISK       "Disk (GB)"           "4"

# Only offer storages that can actually hold a container rootfs.
mapfile -t rootfs_stores < <(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1}')
default_store="${rootfs_stores[0]:-local-lvm}"
if (( ${#rootfs_stores[@]} > 1 )); then
  printf '%s\n' "${DIM}  available: ${rootfs_stores[*]}${RESET}"
fi
ask STORAGE "Storage for the container" "$default_store"

step "Network"
ask BRIDGE  "Bridge"                       "vmbr0"
ask NET     "Address (dhcp, or CIDR)"      "dhcp"
if [[ "$NET" != "dhcp" ]]; then
  ask GATEWAY "Gateway"                    ""
fi

step "Apollo"
printf '%s\n' "${DIM}  The Jellyfin address only prefills the sign-in form — anyone can enter${RESET}"
printf '%s\n' "${DIM}  a different one there. It must be reachable from the BROWSER, not just${RESET}"
printf '%s\n' "${DIM}  from this container.${RESET}"
# No default: a plausible-looking example address gets accepted by reflex and
# bakes a broken config into the build.
ask JELLYFIN_URL   "Jellyfin address (required)"      ""
printf '%s\n' "${DIM}  Optional. Leave blank to set it later in Dashboard → Connections.${RESET}"
ask JELLYSEERR_URL "Jellyseerr address (optional)"    ""
ask PORT           "Port Apollo listens on"           "4173"
ask REPO           "Repository"                       "https://github.com/DPilat-Dev/Apollo.git"
ask BRANCH         "Branch"                           "main"
ask_yes_no START_ON_BOOT "Start on boot? (yes/no)"    "yes"

# --------------------------------------------------------------- validation

[[ "$CTID" =~ ^[0-9]+$ ]] || die "Container ID must be a number."
pct status "$CTID" >/dev/null 2>&1 && die "Container $CTID already exists. Pick another ID."
[[ "$CORES" =~ ^[0-9]+$ && "$RAM" =~ ^[0-9]+$ && "$DISK" =~ ^[0-9]+$ ]] || die "Cores, memory and disk must be numbers."
[[ "$PORT" =~ ^[0-9]+$ ]] || die "Port must be a number."
if [[ -z "${JELLYFIN_URL:-}" ]]; then
  die "A Jellyfin address is required — e.g. http://192.168.1.23:8096 or https://jellyfin.example.com"
fi
[[ "$JELLYFIN_URL" =~ ^https?:// ]] \
  || die "Jellyfin address must start with http:// or https:// — got '${JELLYFIN_URL}'"

# Catch a typo now rather than after a five-minute build.
info "checking ${JELLYFIN_URL} …"
if curl -fsS -m 8 -o /dev/null "${JELLYFIN_URL%/}/System/Info/Public" 2>/dev/null; then
  ok "Jellyfin answered"
else
  warn "Could not reach ${JELLYFIN_URL}/System/Info/Public from this host."
  warn "It must be reachable from the BROWSER, so this is not always fatal —"
  warn "but a typo here means a broken build."
  if (( ! ASSUME_YES )); then
    read -r -p "  Continue anyway? [y/N]: " cont || true
    [[ "${cont,,}" =~ ^y ]] || die "Stopped. Re-run with the correct address."
  fi
fi
if [[ -n "${JELLYSEERR_URL:-}" && ! "$JELLYSEERR_URL" =~ ^https?:// ]]; then
  die "Jellyseerr address must start with http:// or https://"
fi

# Mixed content is the single most common way this install ends up broken.
if [[ -n "${PUBLIC_HTTPS:-}" || "$JELLYFIN_URL" =~ ^http:// ]]; then
  if [[ "$JELLYFIN_URL" =~ ^http:// ]]; then
    warn "Jellyfin is plain HTTP. If you later serve Apollo over HTTPS, browsers"
    warn "will block every Jellyfin request as mixed content. Use an HTTPS"
    warn "Jellyfin address if Apollo will be public."
  fi
fi

# ------------------------------------------------------------------ confirm

step "Summary"
cat <<SUMMARY
  Container    ${BOLD}${CTID}${RESET} (${CT_HOSTNAME}), unprivileged
  Resources    ${CORES} core(s), ${RAM} MB RAM, ${DISK} GB on ${STORAGE}
  Network      ${BRIDGE}, ${NET}${GATEWAY:+ via $GATEWAY}
  Jellyfin     ${JELLYFIN_URL}
  Jellyseerr   ${JELLYSEERR_URL:-(configure later in the dashboard)}
  Listens on   :${PORT}
  Source       ${REPO} (${BRANCH})
SUMMARY

if (( ! ASSUME_YES )); then
  read -r -p "
Create this container? [y/N]: " go || true
  [[ "${go,,}" =~ ^y ]] || { echo "Cancelled — nothing was created."; exit 0; }
fi

# ------------------------------------------------------------------ template

step "Debian template"
TEMPLATE_STORE="${TEMPLATE_STORE:-local}"
pveam update >/dev/null 2>&1 || true
template=$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-1[23]-standard' | sort -V | tail -1)
[[ -n "$template" ]] || die "No Debian template found in the Proxmox catalogue."

if pveam list "$TEMPLATE_STORE" 2>/dev/null | grep -q "$template"; then
  ok "$template already downloaded"
else
  info "Downloading $template …"
  pveam download "$TEMPLATE_STORE" "$template" >/dev/null
  ok "downloaded"
fi

# ----------------------------------------------------------------- create CT

step "Creating container $CTID"
net="name=eth0,bridge=${BRIDGE}"
if [[ "$NET" == "dhcp" ]]; then
  net="${net},ip=dhcp"
else
  net="${net},ip=${NET}"
  [[ -n "${GATEWAY:-}" ]] && net="${net},gw=${GATEWAY}"
fi

onboot=0; [[ "$START_ON_BOOT" == "yes" ]] && onboot=1

pct create "$CTID" "${TEMPLATE_STORE}:vztmpl/${template}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM" --swap $((RAM / 2)) \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "$net" \
  --unprivileged 1 --features nesting=1 \
  --onboot "$onboot" \
  --description "Apollo — a modern web client for Jellyfin" >/dev/null
ok "created"

pct start "$CTID" >/dev/null
info "waiting for network …"
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then break; fi
  sleep 2
done
pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 \
  || die "Container has no network. Check the bridge and address settings."
ok "network up"

# -------------------------------------------------------------- provisioning

run() { pct exec "$CTID" -- bash -lc "$1"; }

step "Installing dependencies"
run "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq curl git ca-certificates >/dev/null"
run "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null"
ok "node $(run 'node -v' | tr -d '\r')"

step "Installing Apollo"
run "adduser --system --group --home /opt/apollo apollo >/dev/null 2>&1 || true"
run "git clone -q --branch '${BRANCH}' '${REPO}' /opt/apollo"

# .env is read at build time; the runtime file is what the dashboard edits.
run "printf 'VITE_JELLYFIN_SERVER=%s\n' '${JELLYFIN_URL}' > /opt/apollo/.env"
if [[ -n "${JELLYSEERR_URL:-}" ]]; then
  run "printf '{\n  \"jellyseerrTarget\": \"%s\"\n}\n' '${JELLYSEERR_URL}' > /opt/apollo/apollo.runtime.json"
fi

info "building (this takes a couple of minutes) …"
run "cd /opt/apollo && npm ci --silent >/dev/null 2>&1 && npm run build >/dev/null 2>&1"
run "chown -R apollo:apollo /opt/apollo"
ok "built"

step "Setting up the service"
run "sed 's/^Environment=PORT=.*/Environment=PORT=${PORT}/' /opt/apollo/apollo.service > /etc/systemd/system/apollo.service"
run "systemctl daemon-reload && systemctl enable --now apollo >/dev/null 2>&1"
sleep 2
run "systemctl is-active --quiet apollo" || {
  warn "Service did not start. Logs:"
  run "journalctl -u apollo -n 30 --no-pager" || true
  die "Install finished but Apollo is not running."
}
ok "running"

# ------------------------------------------------------------------- report

ip=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' | tr -d '\r')

step "Done"
cat <<DONE
  Apollo      ${BOLD}${GREEN}http://${ip}:${PORT}${RESET}
  Container   ${CTID} (${CT_HOSTNAME})

  Sign in with your Jellyfin account. The first admin who signs in gets the
  dashboard at /admin.

  ${DIM}Config lives in the container:${RESET}
    /opt/apollo/.env                  Jellyfin address baked in at build time
    /opt/apollo/apollo.runtime.json   Jellyseerr address, editable in the dashboard

  ${DIM}Manage:${RESET}
    pct enter ${CTID}
    systemctl status apollo
    journalctl -u apollo -f

  ${DIM}Update:${RESET}
    pct exec ${CTID} -- bash -lc 'cd /opt/apollo && sudo -u apollo git pull && sudo -u apollo npm ci && sudo -u apollo npm run build && systemctl restart apollo'
DONE

if [[ "$JELLYFIN_URL" =~ ^http:// ]]; then
  printf '\n'
  warn "Jellyfin is plain HTTP. Serving Apollo over HTTPS later will break it —"
  warn "browsers block mixed content. See docs/proxmox-lxc.md."
fi
