#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22.12 이상을 설치한 뒤 다시 실행해 주세요.'
  exit 1
fi
exec node start.mjs "$@"
