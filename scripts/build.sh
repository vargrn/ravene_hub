#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"

rm -rf "$dist_root"
mkdir -p "$dist_root/server" "$dist_root/.openai" "$dist_root/client"

cp "$project_root/worker/index.js" "$dist_root/server/index.js"
cp "$project_root/worker/index.js" "$dist_root/client/_worker.js"
cp "$project_root/.openai/hosting.json" "$dist_root/.openai/hosting.json"
cp "$project_root"/*.html "$dist_root/client/"
cp -R "$project_root/assets" "$dist_root/client/assets"

if [ -d "$project_root/builds" ]; then
  cp -R "$project_root/builds" "$dist_root/client/builds"
fi

if [ -d "$project_root/db/migrations" ]; then
  mkdir -p "$dist_root/.openai/drizzle"
  cp "$project_root"/db/migrations/*.sql "$dist_root/.openai/drizzle/"
fi

echo "Built $dist_root"
