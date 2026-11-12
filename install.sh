#!/bin/bash
# Install the clean cmux sidebar + Rex-style terminal font.
#   ./install.sh          copy files into place (backs up anything it replaces)
#   ./install.sh --link   symlink instead, so edits in this repo go live (for maintainers)
set -euo pipefail
cd "$(dirname "$0")"
MODE=copy; [ "${1:-}" = "--link" ] && MODE=link
stamp=$(date +%Y%m%d-%H%M%S)

place() { # src dest
  local src="$PWD/$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then cp "$dest" "$dest.bak-$stamp"; echo "  backed up $dest"; fi
  rm -f "$dest"
  if [ $MODE = link ]; then ln -s "$src" "$dest"; else cp "$src" "$dest"; fi
  echo "  $MODE $1 -> $dest"
}

echo "Sidebar"
place sidebars/clean.js "$HOME/.config/cmux/sidebars/clean.js"

echo "Terminal font (SF Mono)"
FONTS=/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts
if ls "$FONTS"/SF-Mono-*.otf >/dev/null 2>&1; then
  mkdir -p "$HOME/Library/Fonts"; cp -n "$FONTS"/SF-Mono-*.otf "$HOME/Library/Fonts/" 2>/dev/null || true
  echo "  SF Mono installed to ~/Library/Fonts"
else
  echo "  SF Mono not found in Terminal.app; skipping font install"
fi
place ghostty/config "$HOME/.config/ghostty/config"

if command -v cmux >/dev/null 2>&1; then
  cmux sidebar validate clean && cmux sidebar select clean && cmux reload-config >/dev/null && echo "Activated in cmux."
else
  echo "cmux CLI not on PATH: open cmux, then run: cmux sidebar select clean && cmux reload-config"
fi
