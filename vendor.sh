#!/bin/bash
# vendor.sh — fetch the Fontra client sources at the pinned commit and copy
# the pieces this project builds from into vendor/.
#
# Pinned to googlefonts/fontra @ 726b854a19620d4e1c58a3960a33db2792b027f8 —
# this is the fork + commit that the avar2-studio .venv has installed
# (see fontra-*.dist-info/direct_url.json there), so the embedded editor
# behaves exactly like the desktop integration.
#
# Idempotent: re-running re-uses the cached clone and re-copies.
set -euo pipefail

FONTRA_REPO="https://github.com/googlefonts/fontra.git"
FONTRA_COMMIT="726b854a19620d4e1c58a3960a33db2792b027f8"

HERE="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HERE/.fontra-cache/fontra"
VENDOR="$HERE/vendor/fontra/src-js"

if [ ! -d "$CACHE/.git" ]; then
  rm -rf "$CACHE"
  git clone --quiet --filter=blob:none --no-checkout "$FONTRA_REPO" "$CACHE"
fi

git -C "$CACHE" fetch --quiet --depth 1 origin "$FONTRA_COMMIT"
git -C "$CACHE" checkout --quiet FETCH_HEAD
echo "vendoring fontra @ $(git -C "$CACHE" rev-parse --short HEAD)"

rm -rf "$VENDOR"
mkdir -p "$VENDOR"
for pkg in fontra-core fontra-webcomponents views-editor; do
  rsync -a --exclude tests --exclude node_modules \
    "$CACHE/src-js/$pkg/" "$VENDOR/$pkg/"
done

# Base paths: the Fontra client hardcodes root-absolute asset URLs
# (/lang/, /data/, /fonts/, /css/, /images/, /tabler-icons/), which only
# resolve when dist/ is served at a domain root. We deploy under a Pages
# project path (/fontra-embed/), so sweep them all relative — they then
# resolve against the document in both layouts. Sweep instead of a patch:
# 60+ call sites across 20 files; a new absolute ref after a re-pin fails
# loudly at runtime (404), not silently here.
for prefix in lang data fonts css images tabler-icons; do
  grep -rlE "[\"'\`]/${prefix}/" "$VENDOR" --include="*.js" --include="*.html" 2>/dev/null \
    | while read -r f; do sed -i.bak -e "s|\"/${prefix}/|\"./${prefix}/|g" -e "s|'/${prefix}/|'./${prefix}/|g" -e "s|\`/${prefix}/|\`./${prefix}/|g" "$f"; done
  find "$VENDOR" -name "*.bak" -delete
done

# editor view stylesheet, referenced by src/embed.html as ./assets/editor.css
rm -rf "$HERE/src/assets"
cp -R "$CACHE/src-js/views-editor/assets" "$HERE/src/assets"

echo "done. Next: npm install && npm run build"
