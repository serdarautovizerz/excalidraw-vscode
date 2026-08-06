// Connection UX layer (Phase 5) — pure geometry helpers.
// Anchors are transient overlays computed from element bounds on every render;
// they are never written into the .excalidraw file.

export type AnchorId = "n" | "s" | "e" | "w";

// Scene coordinates.
export interface Anchor {
  id: AnchorId;
  x: number;
  y: number;
}

export interface AnchorTarget {
  elementId: string;
  anchor: Anchor;
}

// An in-progress connection: source anchor fixed, endpoint following the
// pointer until it snaps to a target anchor.
export interface ConnectDraft {
  sourceId: string;
  sourceAnchor: Anchor;
  pointer: { x: number; y: number };
  target: AnchorTarget | null;
}

const CONNECTABLE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);

export function isConnectable(element: any): boolean {
  return !element.isDeleted && CONNECTABLE_TYPES.has(element.type);
}

// Extensible to 8/12 points later — everything downstream works off Anchor[].
export function anchorsOf(element: any): Anchor[] {
  const { x, y, width, height } = element;
  return [
    { id: "n", x: x + width / 2, y },
    { id: "s", x: x + width / 2, y: y + height },
    { id: "w", x, y: y + height / 2 },
    { id: "e", x: x + width, y: y + height / 2 },
  ];
}

// Topmost connectable element whose bounds (grown by `margin`) contain the
// pointer. Last match wins: highest z-order.
export function connectableAt(
  elements: readonly any[],
  pointer: { x: number; y: number },
  margin = 0
): any | null {
  let hit: any = null;
  for (const element of elements) {
    if (!isConnectable(element)) {
      continue;
    }
    if (
      pointer.x >= element.x - margin &&
      pointer.x <= element.x + element.width + margin &&
      pointer.y >= element.y - margin &&
      pointer.y <= element.y + element.height + margin
    ) {
      hit = element;
    }
  }
  return hit;
}

// Nearest anchor across every connectable element except `excludeId`, within
// `maxDistance` scene units of the pointer; null when nothing is close enough.
export function snapToAnchor(
  elements: readonly any[],
  pointer: { x: number; y: number },
  excludeId: string,
  maxDistance: number
): AnchorTarget | null {
  let best: AnchorTarget | null = null;
  let bestDistance = maxDistance * maxDistance;
  for (const element of elements) {
    if (!isConnectable(element) || element.id === excludeId) {
      continue;
    }
    for (const anchor of anchorsOf(element)) {
      const dx = anchor.x - pointer.x;
      const dy = anchor.y - pointer.y;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { elementId: element.id, anchor };
      }
    }
  }
  return best;
}
