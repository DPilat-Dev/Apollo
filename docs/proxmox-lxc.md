# Running Apollo in a Proxmox LXC

A plain Debian container running Node under systemd. No Docker layer.

## 1. Create the container

On the Proxmox host — unprivileged is fine, Apollo needs no special capabilities:

```bash
pveam update && pveam download local debian-12-standard_12.7-1_amd64.tar.zst

pct create 120 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname apollo \
  --cores 1 --memory 512 --swap 256 \
  --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1 \
  --onboot 1

pct start 120 && pct enter 120
```

512 MB and one core is plenty: the server streams files and forwards requests,
it does no transcoding. Transcoding stays on the Jellyfin host.

## 2. Install Node and Apollo

Inside the container:

```bash
apt update && apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

adduser --system --group --home /opt/apollo apollo
git clone https://github.com/DPilat-Dev/Apollo.git /opt/apollo
cd /opt/apollo

cp .env.example .env
# Set VITE_JELLYFIN_SERVER to an address browsers can reach — see the note
# about mixed content below.
nano .env

npm ci
npm run build
chown -R apollo:apollo /opt/apollo
```

## 3. Run it under systemd

```bash
cp /opt/apollo/apollo.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now apollo
systemctl status apollo --no-pager
```

Apollo is now on `http://<container-ip>:4173`.

The unit is hardened: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
and write access limited to `/opt/apollo` — which it needs because
`apollo.runtime.json` (the Jellyseerr address) lives there.

## 4. Updating

From the Proxmox host:

```bash
pct exec <ctid> -- /opt/apollo/scripts/update.sh
```

Or inside the container, as root:

```bash
/opt/apollo/scripts/update.sh
```

It pulls, rebuilds, hands ownership back to the service account and restarts —
reporting which commits arrived, and dumping the log if the service fails to
come back.

Two things worth knowing if you ever do it by hand. A minimal Debian container
has **no `sudo`**, so `sudo -u apollo …` will not work; you are already root.
And because the checkout is owned by `apollo`, git refuses to operate on it as
root until you allow it once:

```bash
git config --global --add safe.directory /opt/apollo
```

The installer does this for you. `.env` and `apollo.runtime.json` are gitignored,
so an update never overwrites your configuration.

## 5. Mixed content — the one that will bite you

The browser talks to Jellyfin **directly**, not through Apollo. So if you put
Apollo behind HTTPS while `VITE_JELLYFIN_SERVER` still points at a plain
`http://` LAN address, browsers block every Jellyfin request as mixed content
and the app looks completely broken — with console errors that mention CORS
rather than saying "mixed content".

Pick one:

| Setup | Works? |
| --- | --- |
| `http://apollo.lan:4173` → `http://192.168.x.x:8096` | Yes — all plain HTTP |
| `https://apollo.example.com` → `https://jellyfin.example.com` | Yes — all HTTPS |
| `https://apollo.example.com` → `http://192.168.x.x:8096` | **No** — blocked |

If you already publish Jellyfin over HTTPS, point `VITE_JELLYFIN_SERVER` at that
hostname and both sides match.

## 6. Optional: reverse proxy

Anything works, since Apollo is a normal HTTP server. Example nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name apollo.example.com;

    location / {
        proxy_pass http://<container-ip>:4173;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Apollo already forwards `/jellyseerr` itself, so no extra rule is needed for it.
