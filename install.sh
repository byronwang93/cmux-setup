#!/bin/bash
# Install the clean cmux sidebar + Rex-style terminal font.
#   ./install.sh          copy files into place (backs up anything it replaces)
#   ./install.sh --link   symlink the sidebar instead, so edits in this repo go live (for maintainers)
set -euo pipefail
cd "$(dirname "$0")"
MODE=copy; [ "${1:-}" = "--link" ] && MODE=link
stamp=$(date +%Y%m%d-%H%M%S)
MIN_CMUX=0.65.0

# Warn (don't stop) about the two setups that break this sidebar: an old cmux, or
# cmux running from the mounted installer disk image instead of /Applications.
check_cmux() {
  local bin app ver
  bin=$(ps -axo args= | grep -m1 '[c]mux\.app/Contents/MacOS/cmux$' || true)
  if [ -n "$bin" ]; then
    app="${bin%/Contents/MacOS/cmux}"
    case "$app" in /Volumes/*)
      echo "WARNING: cmux is running from the installer disk image ($app)."
      echo "         Quit it, drag cmux into /Applications, eject the disk image, and open that copy." ;;
    esac
  else
    app=/Applications/cmux.app
  fi
  ver=$(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)
  if [ -z "$ver" ]; then
    echo "WARNING: couldn't find cmux. Install it from https://cmux.com first."
  elif [ "$(printf '%s\n%s\n' "$MIN_CMUX" "$ver" | sort -V | head -1)" != "$MIN_CMUX" ]; then
    echo "WARNING: cmux $ver is older than $MIN_CMUX, which this sidebar was built on."
    echo "         Update via cmux > Check for Updates…, then re-run ./install.sh."
  else
    echo "cmux $ver ($app)"
  fi
}
check_cmux

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
