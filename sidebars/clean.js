// clean: Rex-style look over the Dia-style groups sidebar (copied from workspaces.js).
// Plain grey section labels (click to collapse), icon + title rows, nothing else.
// Open: cmux sidebar select clean
//
// The whole sidebar is ONE flat drag surface: group headers and workspace
// rows live in a single Reorderable. Headers are `fixed` (not grabbable, but
// they shift to open gaps like any row), so a workspace can be dragged
// between groups, into a group, or out to the ungrouped area in one gesture.
// The drop resolves to (container group, reorder anchor) from the flat index
// and dispatches workspace.group.add/remove + workspace.reorder.
//
// Group collapse is optimistic (a local signal flips instantly) and syncs via
// workspace.group.collapse/expand so the built-in sidebar agrees.
//
// Install:  cp Examples/CustomSidebars/workspaces.js ~/.config/cmux/sidebars/
// Open:     cmux sidebar open workspaces

// --- optimistic UI -------------------------------------------------------------
// Every user action flips local state the same frame; the cmux command runs
// behind it and the authoritative data context (which refreshes about once a
// second) reconciles: each override clears itself as soon as the data agrees.
let selectOverride = null;
const [selectTick, setSelectTick] = signal(0);

function isSelected(w) {
  selectTick();
  if (!w) return false;
  if (selectOverride) {
    if (data.selectedId() === selectOverride) selectOverride = null; // caught up
    else return w.id === selectOverride;
  }
  return !!w.selected;
}

function selectWorkspace(id) {
  if (!id) return;
  selectOverride = id;
  setSelectTick(selectTick() + 1);
  cmux("workspace.select", { workspace_id: id });
}

const closedOverride = new Set();
const [closeTick, setCloseTick] = signal(0);

// Optimistic tabs order: a bulk drop rearranges rows locally the same frame
// (reorder_many echoes ~1s later); clears itself once the data agrees.
let orderOverride = null;
const [orderTick, setOrderTick] = signal(0);

function setOrderOverride(ids) {
  orderOverride = ids;
  setOrderTick(orderTick() + 1);
}

function visibleWorkspaces() {
  closeTick();
  orderTick();
  let ws = data.workspaces() ?? [];
  for (const id of Array.from(closedOverride)) {
    if (!ws.some((w) => w.id === id)) closedOverride.delete(id); // caught up
  }
  ws = ws.filter((w) => !closedOverride.has(w.id));
  if (orderOverride) {
    const actual = ws.map((w) => w.id).join(",");
    const wanted = orderOverride.filter((id) => ws.some((w) => w.id === id)).join(",");
    if (actual === wanted) {
      orderOverride = null; // caught up
    } else {
      const rank = new Map(orderOverride.map((id, i) => [id, i]));
      ws = [...ws].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    }
  }
  return ws;
}

function closeWorkspace(id) {
  closedOverride.add(id);
  setCloseTick(closeTick() + 1);
  cmux("workspace.close", { workspace_id: id });
}

// Multi-select: Cmd-click toggles, Shift-click extends from the last click
// over the visible row order, plain click clears. The selection drives the
// context menu's bulk actions (group together, move, close).
const multiSelected = new Set();
const [multiTick, setMultiTick] = signal(0);
let lastClickedId = null;

function isMultiSelected(w) {
  multiTick();
  return !!w && multiSelected.has(w.id);
}

function clearMultiSelect() {
  if (multiSelected.size === 0) return;
  multiSelected.clear();
  setMultiTick(multiTick() + 1);
}

function visibleRowIds() {
  return flatEntries().filter((e) => e.kind === "ws").map((e) => e.wsId);
}

function handleRowClick(w, payload) {
  const id = w.id;
  if (payload && payload.cmd) {
    if (multiSelected.has(id)) multiSelected.delete(id);
    else multiSelected.add(id);
    setMultiTick(multiTick() + 1);
  } else if (payload && payload.shift && lastClickedId) {
    const order = visibleRowIds();
    const a = order.indexOf(lastClickedId);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      for (const rid of order.slice(Math.min(a, b), Math.max(a, b) + 1)) multiSelected.add(rid);
      setMultiTick(multiTick() + 1);
    }
  } else {
    clearMultiSelect();
    selectWorkspace(id);
  }
  lastClickedId = id;
}

// The set of workspaces a bulk menu action applies to: the multi-selection
// when the clicked row is part of it, else just the clicked row.
function bulkIds(w) {
  multiTick();
  if (w && multiSelected.has(w.id)) return Array.from(multiSelected);
  return w ? [w.id] : [];
}

const titleOverride = new Map();
const [titleTick, setTitleTick] = signal(0);

function displayTitle(w) {
  titleTick();
  if (!w) return "";
  if (titleOverride.has(w.id)) {
    const t = titleOverride.get(w.id);
    if (w.title === t) titleOverride.delete(w.id); // caught up
    else return t;
  }
  return w.title;
}

// --- inline rename -----------------------------------------------------------
// Double-click a row/header (or its Rename menu item) to edit in place.
// Editing swaps the entry's key, so the keyed reconciler remounts the row as
// an editor; Return commits through workspace(.group).rename, Escape cancels.
const [editingId, setEditingId] = signal(null);

// --- optimistic collapse -----------------------------------------------------
const collapseOverride = new Map();
const [collapseTick, setCollapseTick] = signal(0);

function isCollapsed(g) {
  collapseTick();
  if (collapseOverride.has(g.id)) {
    const v = collapseOverride.get(g.id);
    if (v === g.collapsed) collapseOverride.delete(g.id); // host caught up
    else return v;
  }
  return g.collapsed;
}

function toggleCollapse(g) {
  const next = !isCollapsed(g);
  collapseOverride.set(g.id, next);
  setCollapseTick(collapseTick() + 1);
  cmux(next ? "workspace.group.collapse" : "workspace.group.expand", { group_id: g.id });
}

// --- data helpers ------------------------------------------------------------
const groupById = (id) => (data.groups() ?? []).find((g) => g.id === id);
const membersOf = (id) => visibleWorkspaces().filter((w) => w.group === id);
// The anchor workspace IS the header (matching the built-in sidebar).
const memberRowsOf = (id) => {
  const g = groupById(id);
  return membersOf(id);
};

// One flat entry list. A group renders (header + expanded member rows) at
// its ANCHOR's tabs position - the app's canonical block position - so a
// stray member sitting early in the tabs order can never yank the whole
// group upward. Pinned groups and pinned ungrouped workspaces float to a
// cluster at the top.
const flatEntries = computed(() => {
  const ws = visibleWorkspaces();
  const groups = new Map((data.groups() ?? []).map((g) => [g.id, g]));
  const editing = editingId();
  const wsEntry = (w, groupId) => ({
    kind: "ws",
    id: w.id + (editing === w.id ? ":edit" : ""),
    wsId: w.id,
    editing: editing === w.id,
    groupId,
  });
  const groupSection = (g) => {
    const out = [{
      kind: "header",
      id: "h:" + g.id + (editing === "h:" + g.id ? ":edit" : ""),
      groupId: g.id,
      editing: editing === "h:" + g.id,
    }];
    if (!isCollapsed(g)) {
      for (const m of memberRowsOf(g.id)) out.push(wsEntry(m, g.id));
    }
    return out;
  };

  const pinned = [];
  const rest = [];
  const seen = new Set();
  for (const w of ws) {
    if (w.group && groups.has(w.group)) {
      const g = groups.get(w.group);
      // Emit the group at its anchor's position; a group whose anchor is
      // hidden (optimistically closed) falls back to its first member.
      const isAnchor = w.id === g.anchorId || !ws.some((x) => x.id === g.anchorId);
      if (seen.has(g.id) || !isAnchor) continue;
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...groupSection(g));
    } else if (!w.group) {
      (w.pinned ? pinned : rest).push(wsEntry(w, null));
    }
  }
  // Groups whose anchor never appeared (edge churn): append at the end.
  for (const g of groups.values()) {
    if (!seen.has(g.id) && ws.some((x) => x.group === g.id)) {
      seen.add(g.id);
      (g.pinned ? pinned : rest).push(...groupSection(g));
    }
  }
  // An ungrouped tab right after a group gets a gap, so it doesn't read as a member.
  const all = [...pinned, ...rest];
  for (let i = 1; i < all.length; i += 1) {
    if (all[i].kind === "ws" && !all[i].groupId && all[i - 1].groupId) all[i].afterGroup = true;
  }
  return all;
});

// --- drop resolution ---------------------------------------------------------
// `index` is the dragged row's slot in the flat list (headers included).
// `extra.side` resolves the ambiguous boundary slots: "above" nests with the
// row above (e.g. last item of a group), "below" with the row below (right
// after the group, outside it) - chosen by the pointer's X position mid-drag.
// Dragging a group HEADER moves the whole block (extra.block).
function handleMove(id, index, extra) {
  // Use the order currently rendered, including optimistic reorder overrides.
  // The host-provided `index` fields can lag behind that view for one or more
  // frames after a bulk or group move.
  const ws = visibleWorkspaces();

  if (extra && extra.block && id.startsWith("h:")) {
    // Whole-group move. workspace.group.move is NOT usable here: its
    // to_index is a group-slot index (position among groups, clamped to the
    // pin tier), so a tabs index overshoots to "last group" and a drop
    // between ungrouped rows is unreachable. Instead send the full tabs
    // order with the block extracted and re-inserted contiguously (anchor
    // first) at the drop slot - the app's contiguity normalization keeps it.
    const gid = id.slice(2);
    const memberIds = new Set(membersOf(gid).map((w) => w.id));
    const entries = flatEntries().filter((e) => e.id !== id && e.groupId !== gid);
    // The next entry that stays put anchors the drop. A header counts too:
    // dropping right above a (possibly collapsed) group means "before its
    // anchor", not "after its hidden members".
    const nextEntry = entries.slice(index).find((e) => e.kind === "ws" || e.kind === "header");
    const nextId = nextEntry
      ? (nextEntry.kind === "header" ? groupById(nextEntry.groupId)?.anchorId : nextEntry.wsId)
      : null;
    const anchorId = groupById(gid)?.anchorId;
    const blockIds = ws.map((x) => x.id).filter((x) => memberIds.has(x));
    if (anchorId && blockIds.includes(anchorId)) {
      blockIds.splice(blockIds.indexOf(anchorId), 1);
      blockIds.unshift(anchorId);
    }
    const rest = ws.map((x) => x.id).filter((x) => !memberIds.has(x));
    let insertAt = nextId ? rest.indexOf(nextId) : rest.length;
    if (insertAt < 0) insertAt = rest.length;
    const full = [...rest.slice(0, insertAt), ...blockIds, ...rest.slice(insertAt)];
    setOrderOverride(full); // paint the new order now; reorder_many echoes behind it
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(full) });
    return;
  }

  const dragged = ws.find((w) => w.id === id);
  if (!dragged) return;

  // Dragging a row that is part of the multi-selection moves the WHOLE
  // selection: the visible selected rows gather contiguously at the drop
  // slot (visual order preserved) and all take the slot's container. This is
  // the platform-standard resolution for non-contiguous selections and for
  // selections mixing in-group and ungrouped rows. Hidden rows (inside a
  // collapsed group) never move - what you see is what you drag.
  multiTick();
  const bulk = multiSelected.has(id) && multiSelected.size > 1;
  const movingIds = bulk
    ? visibleRowIds().filter((rid) => multiSelected.has(rid) || rid === id)
    : [id];
  const moving = new Set(movingIds);

  const entries = flatEntries().filter((e) => e.id !== id);
  // Neighbors that will NOT move: rows moving with the drag can't define the
  // drop's container or anchor.
  let prev = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.kind === "ws" && moving.has(e.wsId ?? e.id)) continue;
    prev = e;
    break;
  }
  const stays = (e) => !(e.kind === "ws" && moving.has(e.wsId ?? e.id));
  // The drop's tabs-order anchor is the next entry that stays put. A header
  // resolves to its group's ANCHOR workspace: dropping above a group means
  // "before the whole block", never "between its anchor and members" (which
  // would break contiguity and get normalized somewhere else).
  const nextEntry = entries.slice(index).find((e) => {
    if (e.kind === "header") return !moving.has(groupById(e.groupId)?.anchorId);
    return e.kind === "ws" && stays(e);
  });
  const nextAny = entries.slice(index).find(stays) ?? null;
  const nextRefId = nextEntry
    ? (nextEntry.kind === "header" ? groupById(nextEntry.groupId)?.anchorId : (nextEntry.wsId ?? nextEntry.id))
    : null;
  const nextWorkspace = nextRefId ? ws.find((w) => w.id === nextRefId) : null;

  let container;
  if (extra && extra.side === "below") {
    // Nest with what's below: a header below means "above the next group",
    // i.e. ungrouped; a row below means its group (or ungrouped).
    container = nextAny && nextAny.kind === "ws" ? nextAny.groupId : null;
  } else {
    container = prev ? prev.groupId : null;
    // Dropping right below a collapsed group's header means "after the whole
    // group", not "into it" (its rows are hidden), unless it lives there.
    if (prev && prev.kind === "header") {
      const g = groupById(prev.groupId);
      if (g && isCollapsed(g) && dragged.group !== g.id) container = null;
    }
  }

  // Every tab lives in a group: a drop outside one lands in the nearest group.
  if (!container) {
    container = (prev && prev.groupId) || (nextAny && nextAny.groupId) || dragged.group || null;
  }

  for (const rid of movingIds) {
    const row = ws.find((w) => w.id === rid);
    if (!row) continue;
    if ((row.group ?? null) !== container) {
      if (container) {
        cmux("workspace.group.add", { group_id: container, workspace_id: rid });
      } else {
        cmux("workspace.group.remove", { workspace_id: rid });
      }
    }
  }

  if (bulk) {
    // Atomic block placement: send the full tabs order with the moving rows
    // inserted contiguously before the anchor.
    const rest = ws.map((x) => x.id).filter((x) => !moving.has(x));
    let insertAt = nextWorkspace ? rest.indexOf(nextWorkspace.id) : rest.length;
    if (insertAt < 0) insertAt = rest.length;
    const full = [...rest.slice(0, insertAt), ...movingIds, ...rest.slice(insertAt)];
    setOrderOverride(full); // gather instantly; reorder_many echoes behind it
    cmux("workspace.reorder_many", { workspace_ids: JSON.stringify(full) });
    clearMultiSelect();
    return;
  }

  if (nextWorkspace) {
    const draggedPosition = ws.findIndex((w) => w.id === dragged.id);
    const before = ws.findIndex((w) => w.id === nextWorkspace.id);
    const target = draggedPosition < before ? before - 1 : before;
    cmux("workspace.reorder", { workspace_id: id, index: target });
  } else {
    cmux("workspace.reorder", { workspace_id: id, index: ws.length - 1 });
  }
  // Dragging an unselected row with a selection active clears the stale
  // selection (platform convention).
  clearMultiSelect();
}

// --- rows ----------------------------------------------------------------------
const hasAgent = (w) => !!w && (w.agents ?? []).some((a) => a.status !== "ended");

const isWorking = (w) => !!w && !(w.unread > 0) && (w.agents ?? []).some((a) => a.status === "working");
const dotStep = () => Math.floor(data.clock()?.epoch ?? 0) % 3;

// --- tab icons ---------------------------------------------------------------------
// A custom icon is stored in the workspace description as "[icon:<sf-symbol>]" (cmux
// saves descriptions across restarts); the tile colour is the workspace colour.
// No custom icon = auto: Claude tile while an agent runs, grey terminal otherwise.
const ICONS = [
  ["Claude", "asterisk", "#D97757"], ["Terminal", "terminal", "#6B6B70"],
  ["Bug", "ladybug", "#E5484D"], ["Hammer", "hammer", "#8E6E53"],
  ["Globe", "globe", "#3E8ED0"], ["Book", "book", "#5B8C5A"],
  ["Bell", "bell", "#E0A030"], ["Flag", "flag", "#D9534F"],
  ["Chart", "chart.bar", "#4C9EEB"], ["Bolt", "bolt", "#E5B000"],
  ["Star", "star", "#D4A017"], ["Gear", "gearshape", "#7A7A80"],
  ["Cube (3D)", "cube", "#8E5BD9"], ["Paintbrush", "paintbrush", "#D9578E"],
  ["Game", "gamecontroller", "#2FA37B"], ["Leaf", "leaf", "#4CAF50"],
  ["Flame", "flame", "#F06A2A"], ["Briefcase", "briefcase", "#6E5A46"],
  ["House", "house", "#3A9C9C"], ["Heart", "heart", "#E0457B"],
];
const ICON_RE = /\s*\[icon:([a-z0-9.]+)\]\s*/;
const COLORS = [["Orange", "#D97757"], ["Red", "#E5484D"], ["Amber", "#E0A030"],
  ["Green", "#4CAF50"], ["Teal", "#3A9C9C"], ["Blue", "#3E8ED0"], ["Indigo", "#5B5BD6"],
  ["Purple", "#8E5BD9"], ["Pink", "#E0457B"], ["Brown", "#8E6E53"], ["Grey", "#6B6B70"]];

function customIcon(w) {
  const m = (w?.description ?? "").match(ICON_RE);
  return m ? m[1] : null;
}
function iconSymbol(w) {
  return customIcon(w) ?? (hasAgent(w) ? "asterisk" : "terminal");
}
function iconTint(w) {
  if (w?.color) return w.color;
  const sym = iconSymbol(w);
  return (ICONS.find((i) => i[1] === sym) ?? [0, 0, "#6B6B70"])[2];
}
function setIcon(w, sym) {
  const rest = (w?.description ?? "").replace(ICON_RE, " ").trim();
  const desc = sym ? (rest ? rest + " " : "") + "[icon:" + sym + "]" : rest;
  if (desc) cmux("workspace.action", { action: "set_description", workspace_id: w.id, description: desc });
  else cmux("workspace.action", { action: "clear_description", workspace_id: w.id });
}
function setTileColor(w, hex) {
  if (hex) cmux("workspace.action", { action: "set_color", workspace_id: w.id, color: hex });
  else cmux("workspace.action", { action: "clear_color", workspace_id: w.id });
}
function workspaceMenu(w) {
  const act = (action) => () =>
    cmux("workspace.action", { action, workspace_id: w().id });
  const groupItems = (data.groups() ?? []).map((g) =>
    Button(() => (groupById(g.id)?.name ?? ""), () => {
      for (const id of bulkIds(w())) cmux("workspace.group.add", { group_id: g.id, workspace_id: id });
      clearMultiSelect();
    }));
  const count = () => bulkIds(w()).length;
  return [
    Button(() => (count() > 1 ? "New Group from " + count() + " Workspaces" : "New Group with This"), () => {
      cmux("workspace.group.create", {
        name: "New Group",
        child_workspace_ids: JSON.stringify(bulkIds(w())),
      });
      clearMultiSelect();
    }),
    Divider(),
    Button("Rename", () => setEditingId(w().id)),
    Menu("Icon", [
      Button("Auto (Claude / Terminal)", () => setIcon(w(), null)),
      Divider(),
      ...ICONS.map(([label, sym]) => Button(label, () => setIcon(w(), sym))),
    ]),
    Menu("Icon Colour", [
      Button("Default", () => setTileColor(w(), null)),
      Divider(),
      ...COLORS.map(([label, hex]) => Button(label, () => setTileColor(w(), hex))),
    ]),
    Button(() => (w()?.pinned ? "Unpin" : "Pin"), () =>
      cmux("workspace.action", { action: w()?.pinned ? "unpin" : "pin", workspace_id: w().id })),
    Button(() => (w()?.unread > 0 ? "Mark as Read" : "Mark as Unread"), () =>
      cmux("workspace.action", { action: w()?.unread > 0 ? "mark_read" : "mark_unread", workspace_id: w().id })),
    Divider(),
    Menu("Move", [
      Button("Move Up", act("move_up")),
      Button("Move Down", act("move_down")),
      Button("Move to Top", act("move_top")),
    ]),
    Menu("Move to Group", groupItems),
    Divider(),
    Button("Close Others", act("close_others")).destructive(),
    Button(() => (count() > 1 ? "Close " + count() + " Workspaces" : "Close"), () => {
      for (const id of bulkIds(w())) closeWorkspace(id);
      clearMultiSelect();
    }).destructive(),
  ];
}

function workspaceRow(w, entry) {
  // The title owns the FULL row width; badge, pin, and close button FLOAT
  // over its trailing edge (ZStack trailing) instead of reserving layout.
  // No fades anywhere (they read as glitches when they appear); overflow
  // truncates with a plain ellipsis, and a title too long to fit starts
  // marqueeing after the hover holds 0.5s.
  // Padding lives on an INNER layer: the host draws a node's background before its
  // own padding, so the highlight must sit on an outer layer that wraps the padded row.
  return ZStack({ alignment: "leading" }, [ZStack({ alignment: "trailing" }, [
    HStack({ spacing: 9 }, [
      // The glyph sits in a fixed 11pt box (an inner layer), and the tile is drawn on
      // the outer layer, so every icon's tile is the same size whatever the symbol.
      ZStack({}, [
        Image(() => iconSymbol(w()))
          .font(9).weight("medium").color("white")
          .frame({ width: 11, height: 11 }),
      ])
        .padding(4)
        .background(() => iconTint(w()))
        .cornerRadius(5),
      Text(() => displayTitle(w()))
        .font(13)
        .lineLimit(1)
        .truncation("tail")
        .marquee()
        .color(() => (isSelected(w()) ? "primary" : "secondary")),
      Spacer({ minLength: 0 }),
    ])
      .frame({ maxWidth: "infinity" }),
    ZStack({}, [
      // "Working" dots while an agent in this tab is mid-turn. The sidebar has no
      // animation timers, so the bright dot steps along with the 1s data clock.
      HStack({ spacing: 2.5 }, [0, 1, 2].map((i) =>
        Circle({ size: 3.5 }).fill("#A1A1A6")
          .opacity(() => (isWorking(w()) ? (dotStep() === i ? 1 : 0.35) : 0))))
        .paddingTrailing(4)
        .hideOnHover(),
      // Unread badge at rest; on hover it yields to the close button.
      Text(() => (w()?.unread > 0 ? String(w().unread) : ""))
        .font("caption2").bold().color("white")
        .paddingHorizontal(() => (w()?.unread > 0 ? 5 : 0))
        .paddingVertical(() => (w()?.unread > 0 ? 1 : 0))
        .background(() => (w()?.unread > 0 ? "#E4573D" : null))
        .cornerRadius(7)
        .hideOnHover(),
      // Pin marker shows when pinned and no unread badge claims the slot.
      Image("pin.fill")
        .font(8).color("tertiary")
        .opacity(() => (w()?.pinned && !(w()?.unread > 0) ? 1 : 0))
        .hideOnHover(),
      // Circular close: uniform padding around the glyph + full-round corner
      // (the background hugs content+padding, so padding IS the circle size).
      // The circle only paints while the X ITSELF is hovered (hoverBackground
      // with no resting background tracks the node's own pointer).
      Image("xmark")
        .font(9).weight("semibold").color("secondary")
        .padding(4)
        .cornerRadius(9)
        .hoverBackground("#7f7f7f4a")
        .showOnHover()
        .onTap(() => closeWorkspace(w().id)),
    ]),
  ])
    .paddingHorizontal(10)
    .paddingVertical(7)
    .frame({ maxWidth: "infinity" })])
    .cornerRadius(10)
    .background(() => (isMultiSelected(w()) ? "#4C9EEB33" : (isSelected(w()) ? "#7f7f7f3d" : null)))
    .hoverBackground(() => (isMultiSelected(w()) ? "#4C9EEB33" : (isSelected(w()) ? "#7f7f7f3d" : "#7f7f7f24")))
    .paddingTop(() => (entry().afterGroup ? 14 : 0))
    .frame({ maxWidth: "infinity" })
    .block(() => (entry().groupId ? "h:" + entry().groupId : null))
    .dragSet(() => (isMultiSelected(w()) ? "multi" : null))
    .onTap((payload) => handleRowClick(w(), payload))
    .onDoubleTap(() => setEditingId(w().id))
    .contextMenu(workspaceMenu(w));
}

// In-place editor row (same box as a workspace row).
function workspaceEditRow(w, entry) {
  return HStack({ spacing: 8 }, [
    TextField(() => w()?.title ?? "", {
      placeholder: "Workspace name",
      onSubmit: (t) => {
        const title = (t ?? "").trim();
        if (title) {
          titleOverride.set(w().id, title);
          setTitleTick(titleTick() + 1);
          cmux("workspace.action", { action: "rename", workspace_id: w().id, title });
        } else {
          cmux("workspace.action", { action: "clear_name", workspace_id: w().id });
        }
        setEditingId(null);
      },
      onCancel: () => setEditingId(null),
    }).font(13),
  ])
    .paddingHorizontal(10)
    .paddingVertical(7)
    .cornerRadius(8)
    .background("#7f7f7f3d")
    .frame({ maxWidth: "infinity" });
}

function groupHeader(groupId) {
  const g = () => groupById(groupId) ?? { id: groupId, name: "", collapsed: false, pinned: false };
  const anchor = () => (data.workspaces() ?? []).find((w) => w.id === g().anchorId);
  const groupAct = (action) => () =>
    cmux("workspace.group.action", { group_id: groupId, action });
  // Inner layer carries the padding, outer layer the hover highlight (the
  // host puts padding outside backgrounds, so this keeps the label inset
  // inside the highlight). The outer paddingTop is the gap above the group.
  return ZStack({ alignment: "leading" }, [HStack({ spacing: 6 }, [
    Text(() => g().name).font(12).weight("semibold").lineLimit(1).truncation("tail")
      .color("tertiary"),
    Text(() => (isCollapsed(g()) ? String(membersOf(groupId).length) : ""))
      .font(11).monospaced().color("tertiary"),
    Spacer(),
    Image("plus.circle")
      .font(12).color("secondary")
      .frame({ width: 18, height: 18 })
      .cornerRadius(9)
      .hoverBackground("#7f7f7f33")
      .showOnHover()
      .onTap(() => cmux("workspace.group.new_workspace", { group_id: groupId })),
    Image("chevron.right")
      .font(10).weight("semibold").color("secondary")
      .rotation(() => (isCollapsed(g()) ? 0 : 90))
      .frame({ width: 18, height: 18 })
      .cornerRadius(9)
      .hoverBackground("#7f7f7f33")
      .showOnHover()
      .onTap(() => toggleCollapse(g())),
  ])
    .paddingHorizontal(10)
    .paddingVertical(4)
    .frame({ maxWidth: "infinity" })])
    .cornerRadius(8)
    .hoverBackground("#7f7f7f24")
    .paddingTop(4)
    .frame({ maxWidth: "infinity" })
    .fixed()
    .block("h:" + groupId)
    .onTap(() => toggleCollapse(g()))
    .onDoubleTap(() => setEditingId("h:" + groupId))
    .contextMenu([
      Button("Rename Group", () => setEditingId("h:" + groupId)),
      Button(() => (isCollapsed(g()) ? "Expand" : "Collapse"), () => toggleCollapse(g())),
      Button(() => (g().pinned ? "Unpin Group" : "Pin Group"), () =>
        cmux("workspace.group.action", { group_id: groupId, action: g().pinned ? "unpin" : "pin" })),
      Divider(),
      Button("Ungroup", groupAct("ungroup")),
      Button("Delete Group", groupAct("delete")).destructive(),
    ]);
}

// Identical geometry to groupHeader (chevron box, paddings, semibold 12)
// so entering/leaving rename changes nothing but the text becoming editable.
function groupEditRow(groupId) {
  const g = () => groupById(groupId);
  return HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(10).weight("semibold").color("tertiary")
      .rotation(() => (isCollapsed(g() ?? {}) ? 0 : 90))
      .frame({ width: 14, height: 16 }),
    TextField(() => g()?.name ?? "", {
      placeholder: "Group name",
      onSubmit: (t) => {
        const name = (t ?? "").trim();
        if (name) cmux("workspace.group.rename", { group_id: groupId, name });
        setEditingId(null);
      },
      onCancel: () => setEditingId(null),
    }).font(12).weight("semibold"),
  ])
    .paddingLeading(10)
    .paddingTrailing(10)
    .paddingVertical(5)
    .cornerRadius(8)
    .background("#7f7f7f3d")
    .frame({ maxWidth: "infinity" })
    .fixed();
}

// --- every tab lives in a group ----------------------------------------------------
// New tabs join the group of the tab you were on; any other ungrouped tab (existing
// ones, or ones left over after Ungroup / Delete Group) goes to an "Inbox" group,
// created on demand. Requests are throttled so the 1s data refresh can't double-send.
const INBOX = "Inbox";
let lastGroupId = null;            // group of the most recently selected grouped tab
let knownIds = null;               // tab ids seen so far (null until the first pass)
const pendingSince = new Map();    // tab id -> ms when we last asked cmux to group it
let inboxRequestedAt = 0;

computed(() => {
  const ws = data.workspaces();
  const groups = data.groups();
  if (!ws || !groups) return 0;
  const sel = ws.find((w) => w.id === data.selectedId());
  if (sel && sel.group) lastGroupId = sel.group;

  const now = Date.now();
  const groupIds = new Set(groups.map((g) => g.id));
  if (lastGroupId && !groupIds.has(lastGroupId)) lastGroupId = null;
  const firstPass = knownIds === null;
  const seen = knownIds ?? new Set();

  const toInbox = [];
  for (const w of ws) {
    const isNew = !firstPass && !seen.has(w.id);
    seen.add(w.id);
    if (w.group && groupIds.has(w.group)) { pendingSince.delete(w.id); continue; }
    if (now - (pendingSince.get(w.id) ?? 0) < 4000) continue;
    if (isNew && lastGroupId) {
      pendingSince.set(w.id, now);
      cmux("workspace.group.add", { group_id: lastGroupId, workspace_id: w.id });
    } else {
      toInbox.push(w.id);
    }
  }
  knownIds = seen;

  if (toInbox.length) {
    const inbox = groups.find((g) => g.name === INBOX);
    if (inbox) {
      for (const id of toInbox) {
        pendingSince.set(id, now);
        cmux("workspace.group.add", { group_id: inbox.id, workspace_id: id });
      }
    } else if (now - inboxRequestedAt > 4000) {
      inboxRequestedAt = now;
      for (const id of toInbox) pendingSince.set(id, now);
      cmux("workspace.group.create", { name: INBOX, child_workspace_ids: JSON.stringify(toInbox) });
    }
  }
  return toInbox.length;
});

// --- "+ New group" footer -------------------------------------------------------
// cmux groups are owned by a workspace: a new group starts with the Cmd-click
// multi-selection in it, or else one fresh tab; drag more tabs in afterwards.
const [creatingGroup, setCreatingGroup] = signal(false);
const footerMode = computed(() => [creatingGroup() ? "edit" : "btn"]);

function newGroupFooter() {
  return ForEach({ items: footerMode, key: (m) => m }, (m) =>
    m() === "edit"
      ? TextField("", {
          placeholder: "New group name…",
          autofocus: true,
          onSubmit: (t) => {
            const name = (t ?? "").trim();
            if (name) {
              multiTick();
              // A tab that already heads a group can't join another one; skip those.
              const anchors = new Set((data.groups() ?? []).map((g) => g.anchorId));
              const ids = Array.from(multiSelected).filter((id) => !anchors.has(id));
              if (ids.length) {
                cmux("workspace.group.create", { name, child_workspace_ids: JSON.stringify(ids) });
              } else {
                // No selection: a new group with one fresh tab in it; drag others in.
                cmux("workspace.group.create", { name });
              }
              clearMultiSelect();
            }
            setCreatingGroup(false);
          },
          onCancel: () => setCreatingGroup(false),
        })
          .font(12)
          .paddingHorizontal(10).paddingVertical(5)
          .cornerRadius(8).background("#7f7f7f3d")
          .frame({ maxWidth: "infinity" })
      : HStack({ spacing: 6 }, [
          Image("plus").font(10).weight("semibold").color("tertiary"),
          Text("New group").font(12).color("tertiary"),
          Spacer(),
        ])
          .paddingHorizontal(10).paddingVertical(5)
          .cornerRadius(8).hoverBackground("#7f7f7f24")
          .frame({ maxWidth: "infinity" })
          .onTap(() => setCreatingGroup(true))
  );
}

// --- root ------------------------------------------------------------------------
sidebar(() =>
  VStack({ spacing: 4 }, [
  Reorderable(
    {
      items: flatEntries,
      key: (e) => e.id,
      spacing: 2,
      onMove: handleMove,
    },
    (e, key) => {
      const entry = e(); // kind, ids, and editing are stable per key
      if (entry.kind === "header") {
        return entry.editing ? groupEditRow(entry.groupId) : groupHeader(entry.groupId);
      }
      const w = () => (data.workspaces() ?? []).find((x) => x.id === entry.wsId);
      return entry.editing ? workspaceEditRow(w, e) : workspaceRow(w, e);
    }
  ),
  newGroupFooter(),
  ]),
  { surface: "glass" }
)
