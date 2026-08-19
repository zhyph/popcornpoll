# PopcornPoll

Self-hosted, group movie-night picker for Plex. Swipe Tinder-style through a
shared candidate pool; a title becomes a match once your group's chosen
threshold of yes-votes is reached. A solo mode is also available for
deciding alone.

## Requirements

- A Plex Media Server, reachable from wherever you run this container.
- Docker.
- A [TMDB API key](https://www.themoviedb.org/settings/api) — **required**:
  it's not just for the opt-in TMDB-extended candidate source, it's also
  what lets the app rank your own Plex library by how well-regarded each
  title is, rather than picking randomly.

## Running it

Prebuilt multi-arch images (amd64/arm64) are published to
`ghcr.io/zhyph/popcornpoll` on every release — you don't need to build
anything yourself.

### docker compose (recommended)

```bash
curl -O https://raw.githubusercontent.com/zhyph/popcornpoll/master/docker-compose.yml
cp .env.example .env   # fill in TMDB_API_KEY, AUTH_ENCRYPTION_KEY, ADMIN_SETUP_TOKEN, APP_ORIGIN
docker compose up -d
```

### docker run

```bash
docker run -d --name popcornpoll \
  -e TMDB_API_KEY=<your key> \
  -e AUTH_ENCRYPTION_KEY=$(openssl rand -hex 16) \
  -e ADMIN_SETUP_TOKEN=$(openssl rand -hex 16) \
  -e APP_ORIGIN=http://<your-host>:3000 \
  -p 3000:3000 \
  -v popcornpoll-data:/data \
  ghcr.io/zhyph/popcornpoll:latest
```

Then visit `http://<your-host>:3000/setup?token=<your ADMIN_SETUP_TOKEN>`
once to link your Plex server — the token pre-fills the admin-token field
(you can also paste it in by hand instead of using the URL). The page
walks you through Plex's own PIN-auth flow: it shows a one-time code and
a link to `app.plex.tv/auth` to approve it from your Plex account, then
lets you pick which of your Plex servers and which of that server's
movie libraries to use. Once linked, use the page's "Sync now" button (or
wait for the periodic library sync) to pull your library in.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | TMDB v3 API key — powers both the opt-in TMDB candidate source and Plex-library reputation ranking. |
| `AUTH_ENCRYPTION_KEY` | yes | Encrypts the stored Plex token at rest. Generate with `openssl rand -hex 16`. Changing this invalidates the stored Plex link — you'll be asked to relink. |
| `ADMIN_SETUP_TOKEN` | yes | Gates the one-time `/setup` flow that links/relinks Plex. Keep this secret — anyone with it can repoint your instance's Plex source. |
| `APP_ORIGIN` | yes | The exact origin (scheme + host + port) you reach this app at. Used to reject cross-site WebSocket/API requests. |
| `TRUSTED_PROXY_HOPS` | no (default `0`) | If you run this behind a reverse proxy, set this to the number of proxy hops so rate limiting reads the real client IP from `X-Forwarded-For` instead of the proxy's own. |
| `PORT` | no (default `3000`) | |
| `DATA_DIR` | no (default `./data`, `/data` in the Docker image) | Where the SQLite file lives — mount a volume here. |

## Network exposure

This app has **no participant-facing login** by design — anyone who can
reach it can create a room against your Plex library. It's built to run on
a trusted network (your home LAN, a VPN, or something like Tailscale). If
you expose it beyond that, put it behind your own access control (a
reverse-proxy with basic auth, an authenticating gateway, etc.) — this is
your responsibility, not something the app does for you.

Room creation, the WebSocket connection, and the solo pool endpoint are
all rate-limited **per client IP**. If your whole group joins from behind
the same NAT (one home network, campus wifi, a shared office), they
share one bucket — expect a
group of many people on one IP to hit the limit sooner than the same
number of people spread across different networks. This is deliberate
(it's what stops one bad actor from spamming rooms) but worth knowing
before you assume a 429 means something is broken.

## Backups and upgrades

Everything the app needs to remember lives in one SQLite file under
`DATA_DIR` (the `popcornpoll-data` volume in the examples above) — back
that up and you've backed up your whole instance (linked Plex server,
synced library, match history). Stop the container before copying the
file to get a consistent snapshot:

```bash
docker compose stop
cp /var/lib/docker/volumes/<project>_popcornpoll-data/_data/popcornpoll.db ./popcornpoll.db.bak
docker compose start
```

To upgrade, pull the new image and recreate the container
(`docker compose pull && docker compose up -d`, or the equivalent
`docker pull` + `docker run` if you're not using compose) — schema
migrations in `server/db/migrations` run automatically against the
existing database on startup. Take a backup first; if a migration ever
misbehaves, restoring the pre-upgrade `.db` file and pinning the previous
image tag rolls you back completely.

## Reverse proxy notes

If you put this behind nginx/Caddy/Apache, you must:
1. Pass through the WebSocket `Upgrade`/`Connection` headers (all three
   proxies need explicit config for this — it's the single most common
   self-hosting failure mode for a WebSocket-based app).
2. Set `X-Forwarded-For` correctly and set `TRUSTED_PROXY_HOPS` to match,
   or rate limiting will either block every real visitor as one IP or not
   rate-limit anyone at all.

For the QR code / copy-link / share-sheet room-sharing affordances to work
at their best, serve over HTTPS (a reverse-proxy cert, Tailscale's own
HTTPS, or mkcert for a LAN address) — they degrade gracefully over plain
HTTP but work better with it.

## Development

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
npm test                # unit tests (Vitest)
npm run test:e2e        # end-to-end tests (Playwright, runs against FAKE_EXTERNAL_APIS)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

[MIT](LICENSE)
