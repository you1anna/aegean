#!/bin/sh
# Use the real Git directly for read/local operations. Keep fault injection
# and the synthetic origin URL handling in fake-cli.cjs.
fixture_bin=${0%/*}
case "$*" in
  *'add -A -- . '*) exec "$fixture_bin/faults/git" "$@" ;;
  *'remote get-url '*origin) exec "$fixture_bin/faults/git" "$@" ;;
esac
for arg in "$@"; do
  if [ "$arg" = push ]; then
    exec "$fixture_bin/faults/git" "$@"
  fi
done
exec "$fixture_bin/real/git" "$@"
