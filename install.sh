#!/bin/bash
# Install the clean cmux sidebar + Rex-style terminal font.
#   ./install.sh          copy files into place (backs up anything it replaces)
#   ./install.sh --link   symlink the sidebar instead, so edits in this repo go live (for maintainers)
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
# Merge, don't replace: the font settings go in a marked block at the end of the
# user's Ghostty config (last value wins), so their theme/keybinds/etc. stay.
GCFG="$HOME/.config/ghostty/config"
if [ -L "$GCFG" ] && [ "$(readlink "$GCFG")" = "$PWD/ghostty/config" ]; then
  echo "  ghostty config already linked to this repo"
elif [ $MODE = link ] && [ ! -e "$GCFG" ]; then
  place ghostty/config "$GCFG"
else
  mkdir -p "$(dirname "$GCFG")"; touch "$GCFG"
  cp "$GCFG" "$GCFG.bak-$stamp"
  { sed '/^# >>> cmux-setup >>>$/,/^# <<< cmux-setup <<<$/d' "$GCFG.bak-$stamp"
    echo "# >>> cmux-setup >>>"
    grep -v '^#' ghostty/config | sed '/^$/d'
    echo "# <<< cmux-setup <<<"
  } > "$GCFG"
  echo "  added font settings to $GCFG (backup: $GCFG.bak-$stamp)"
fi

if command -v cmux >/dev/null 2>&1; then
  cmux sidebar validate clean && cmux sidebar select clean && cmux reload-config >/dev/null && echo "Activated in cmux."
else
  echo "cmux CLI not on PATH: open cmux, then run: cmux sidebar select clean && cmux reload-config"
fi
