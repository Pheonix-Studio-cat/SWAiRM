#!/bin/sh
# Cloudflare Pages build: copies the site into dist/. There is nothing to
# compile — this only keeps tests/, .github/ and the like off the website.
#
# Cloudflare Pages settings:  Build command  sh build.sh
#                             Build output   dist
set -eu

# A failing test stops the deploy: the old version stays online.
if command -v node >/dev/null 2>&1; then
  node --test tests/*.test.mjs
else
  echo "node not found — tests skipped" >&2
fi

rm -rf dist
mkdir dist
cp -r index.html manifest.webmanifest _headers assets js dist/
echo "SWAiRM site in dist/:"
find dist -type f | sort
