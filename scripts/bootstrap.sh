#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! command -v mise >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || { echo 'Install Homebrew or mise using its official documented installer, then rerun.' >&2; exit 1; }
  HOMEBREW_NO_AUTO_UPDATE=1 brew install mise
fi
cd "$repo"
"$repo/scripts/dev" setup
mise exec -- node --input-type=module -e "import { sourceProvenance } from './scripts/source-provenance.mjs'; sourceProvenance(process.cwd());"
"$repo/scripts/dev" check
mise exec -- node scripts/setup-verifier.mjs
mise exec -- node scripts/install.mjs "$@"
