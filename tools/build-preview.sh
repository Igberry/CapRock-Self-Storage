#!/usr/bin/env bash
# Assemble preview/*.html: header Global Section + page + footer, in a
# bare HTML shell, plus a navigation shim so site paths resolve on a
# static dev server. Not part of anything pasted into GHL.
#
#   bash tools/build-preview.sh
set -euo pipefail
cd "$(dirname "$0")/.."

title_for() {
  case "$1" in
    home) echo "Home" ;;
    lubbock-2213-n-quaker) echo "Lubbock Location" ;;
    *) echo "$1" | sed -E 's/-/ /g; s/\b(.)/\u\1/g' ;;
  esac
}

for page in pages/*.html; do
  slug=$(basename "$page" .html)
  out="preview/$slug.html"
  {
    cat <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview: $(title_for "$slug")</title>
<style>
  /* Preview-only reset. In GHL the page builder supplies this. */
  html, body { margin: 0; padding: 0; }
  body { background: #FAF7F1; }
</style>
</head>
<body>
EOF
    cat global-sections/header.html
    echo
    cat "$page"
    echo
    cat global-sections/footer.html
    echo
    cat tools/preview-shim.html
    cat <<EOF
</body>
</html>
EOF
  } > "$out"
  echo "built: $out"
done
