#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
DIST_DIR="$WEB_DIR/dist"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 2
  fi
}

OSSUTIL_BIN="${OSSUTIL_BIN:-ossutil}"
if ! command -v "$OSSUTIL_BIN" >/dev/null 2>&1; then
  if command -v ossutil64 >/dev/null 2>&1; then
    OSSUTIL_BIN="ossutil64"
  else
    echo "ossutil is not installed. Install Alibaba Cloud ossutil first." >&2
    exit 127
  fi
fi

require_env ALIYUN_OSS_BUCKET
ALIYUN_OSS_ENDPOINT="${ALIYUN_OSS_ENDPOINT:-oss-cn-hongkong.aliyuncs.com}"
ALIYUN_OSS_PREFIX="${ALIYUN_OSS_PREFIX:-}"
VITE_ORBIT_API_BASE="${VITE_ORBIT_API_BASE:-https://orbit-agent-api.onrender.com/api/v1}"
export VITE_ORBIT_API_BASE

TARGET="oss://${ALIYUN_OSS_BUCKET}"
if [[ -n "$ALIYUN_OSS_PREFIX" ]]; then
  TARGET="${TARGET}/${ALIYUN_OSS_PREFIX#/}"
  TARGET="${TARGET%/}"
fi

echo "Building web frontend..."
npm --prefix "$WEB_DIR" run build

echo "Uploading $DIST_DIR to $TARGET via $ALIYUN_OSS_ENDPOINT..."
while IFS= read -r -d '' file; do
  rel="${file#$DIST_DIR/}"
  "$OSSUTIL_BIN" cp "$file" "$TARGET/$rel" \
    --endpoint "$ALIYUN_OSS_ENDPOINT" \
    --force \
    --update
done < <(find "$DIST_DIR" -type f -print0)

echo "Done."
echo "Bucket:   $ALIYUN_OSS_BUCKET"
echo "Endpoint: $ALIYUN_OSS_ENDPOINT"
echo "Target:   $TARGET/"
