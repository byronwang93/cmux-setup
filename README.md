# cmux-setup

A clean, Rex-style setup for [cmux](https://cmux.com): a minimal sidebar where every tab lives in a collapsible group, plus SF Mono as the terminal font.

## Install

Needs cmux from `/Applications` (not a mounted installer disk image).

```sh
git clone <this repo> && cd cmux-setup && ./install.sh
```

The installer backs up any file it replaces (`*.bak-<timestamp>`), copies SF Mono out of Terminal.app into `~/Library/Fonts`, and switches cmux to the `clean` sidebar. Your previous sidebar is still listed in the sidebar picker if you want to switch back.

## Using the sidebar

**Groups**
- **＋ New group** at the bottom: type a name and press Return. The group starts with one fresh tab; drag others in. Cmd-click tabs first to start the group with those instead.
- Hover a group label to see **⊕** (new tab in this group) and the **chevron** (collapse). Clicking the label also collapses it.
- Double-click a label to rename; right-click it to pin, ungroup or delete.
- Drag tabs between groups; drag a group label to move the whole group.

**Every tab is in a group**
- A new tab joins the group of the tab you were on.
- Any other loose tab (e.g. after Ungroup / Delete Group) goes to an **Inbox** group, created when needed.
- Dropping a tab between groups puts it in the nearest group.

**Icons**: right-click a tab → **Icon** (Claude, Terminal, Bug, Hammer, Globe, Book, Bell, Flag, Chart, Bolt, Star, Gear, Cube, Paintbrush, Game, Leaf, Flame, Briefcase, House, Heart) and **Icon Colour**. *Auto* shows an orange Claude tile while Claude is running in the tab, a grey terminal otherwise. Icons are saved in the tab's description as `[icon:<sf-symbol>]`, so they survive restarts.

**Multi-select**: Cmd-click / Shift-click tabs to move, group or close several at once.

## Files

| File | Installs to |
|---|---|
| `sidebars/clean.js` | `~/.config/cmux/sidebars/clean.js` |
| `ghostty/config` | `~/.config/ghostty/config` (cmux renders terminals with Ghostty) |

Edit `ghostty/config` to change the font size (`font-size`), then `cmux reload-config`.

## Notes

- cmux groups are always owned by one of their tabs (the "anchor"), so a group can't be empty and a tab that heads a group can't join another one.
- Claude sessions are resumed after a cmux restart by cmux itself (`terminal.autoResumeAgentSessions`, on by default).
