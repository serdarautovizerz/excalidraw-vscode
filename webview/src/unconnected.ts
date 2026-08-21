// Unconnected-arrow highlight — render-only, never written to the file.
//
// Excalidraw bakes strokeColor into the rough.js drawable it caches for each
// element, so the webview cannot recolor an arrow from the outside. The vite
// build therefore patches the options generator (see webview/vite.config.ts):
// when globalThis.__AV_UNCONNECTED_ARROW_COLOR is a string, an arrow that has
// no start or end binding is stroked with it. The element itself keeps its own
// strokeColor; once both ends are bound, it renders normally again.

export const UNCONNECTED_ARROW_COLOR = "#e03131";
export const UNCONNECTED_ARROW_GLOBAL = "__AV_UNCONNECTED_ARROW_COLOR";

export function applyUnconnectedArrowHighlight(enabled: boolean) {
  (globalThis as any)[UNCONNECTED_ARROW_GLOBAL] = enabled
    ? UNCONNECTED_ARROW_COLOR
    : undefined;
}

// Mirrors the condition compiled into the renderer patch.
export function isUnconnectedArrow(element: any): boolean {
  return (
    element.type === "arrow" &&
    !element.isDeleted &&
    (!element.startBinding || !element.endBinding)
  );
}
