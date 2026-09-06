export const shellPanelIds = ["top", "bottom", "left", "right"] as const;

export type ShellPanelId = (typeof shellPanelIds)[number];

export type ShellPanelState = Record<ShellPanelId, boolean>;

export const defaultShellPanelState: ShellPanelState = {
  top: true,
  bottom: true,
  left: true,
  right: true,
};

export function isShellPanelState(value: unknown): value is ShellPanelState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return shellPanelIds.every((panel) => typeof candidate[panel] === "boolean");
}

export function toggleShellPanel(state: ShellPanelState, panel: ShellPanelId): ShellPanelState {
  return { ...state, [panel]: !state[panel] };
}

export function allShellPanelsCollapsed(state: ShellPanelState): boolean {
  return shellPanelIds.every((panel) => !state[panel]);
}

export function toggleAllShellPanels(state: ShellPanelState): ShellPanelState {
  const expanded = allShellPanelsCollapsed(state);
  return { top: expanded, bottom: expanded, left: expanded, right: expanded };
}

export function shellGlobalActionLabel(state: ShellPanelState): "全部收起" | "全部展开" {
  return allShellPanelsCollapsed(state) ? "全部展开" : "全部收起";
}
