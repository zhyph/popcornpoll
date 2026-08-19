#!/bin/sh
# Runs as root (the image's default entrypoint user) so it can align the
# baked-in `popcornpoll` user with whatever host uid/gid owns the mounted
# DATA_DIR, then drops to that user for the actual process. This is what
# lets a bind mount to an arbitrary host path (instead of the default named
# volume) work without the operator having to manually chown it first.
#
# If the container is started with --user (or an equivalent securityContext
# in Kubernetes), we're not root and there's no permission to fix or
# privilege to drop — just exec the command as-is.
set -e

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-999}"
PGID="${PGID:-999}"
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -g popcornpoll)" != "$PGID" ]; then
  groupmod -o -g "$PGID" popcornpoll
fi
if [ "$(id -u popcornpoll)" != "$PUID" ]; then
  usermod -o -u "$PUID" popcornpoll
fi

mkdir -p "$DATA_DIR"
chown -R "$PUID:$PGID" "$DATA_DIR"

exec gosu popcornpoll "$@"
