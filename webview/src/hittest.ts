// Hover hit-testing for linked elements (Phase 8) — pure geometry.
// Excalidraw does not export its own hit-testing, so this implements the
// subset the metadata popover needs: rotation-aware shape tests plus a
// distance-to-segment test for arrows, with a priority rule that stops arrow
// bounding boxes from hijacking the shapes they connect.

interface Point {
  x: number;
  y: number;
}

// Pointer position in the element's local (un-rotated) frame.
function toLocal(element: any, p: Point): Point {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const angle = element.angle ?? 0;
  if (!angle) {
    return p;
  }
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

// Shape-accurate containment for rectangles, diamonds, and ellipses.
export function hitShape(element: any, p: Point, tolerance = 0): boolean {
  const local = toLocal(element, p);
  const halfW = element.width / 2 + tolerance;
  const halfH = element.height / 2 + tolerance;
  if (halfW <= 0 || halfH <= 0) {
    return false;
  }
  const dx = local.x - (element.x + element.width / 2);
  const dy = local.y - (element.y + element.height / 2);
  switch (element.type) {
    case "diamond":
      return Math.abs(dx) / halfW + Math.abs(dy) / halfH <= 1;
    case "ellipse":
      return (dx / halfW) ** 2 + (dy / halfH) ** 2 <= 1;
    default:
      return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
  }
}

function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return dx * dx + dy * dy;
}

// True when the pointer is within `threshold` scene units of the polyline.
export function hitLinear(element: any, p: Point, threshold: number): boolean {
  const points: [number, number][] = element.points ?? [];
  if (points.length < 2) {
    return false;
  }
  const local = toLocal(element, p);
  const thresholdSquared = threshold * threshold;
  for (let i = 0; i < points.length - 1; i++) {
    const a = { x: element.x + points[i][0], y: element.y + points[i][1] };
    const b = {
      x: element.x + points[i + 1][0],
      y: element.y + points[i + 1][1],
    };
    if (distanceToSegmentSquared(local, a, b) <= thresholdSquared) {
      return true;
    }
  }
  return false;
}

const LINEAR_TYPES = new Set(["arrow", "line"]);
const ARROW_HIT_THRESHOLD = 10; // screen px, divided by zoom by the caller

/**
 * The linked element under the pointer. Priority: non-arrow shapes first
 * (smallest area wins, so a small node inside a large container is reachable),
 * then arrows/lines (topmost, i.e. last in the scene array).
 */
export function linkedElementAt(
  elements: readonly any[],
  p: Point,
  zoom: number
): any | null {
  let bestShape: any = null;
  let bestArea = Infinity;
  let bestLinear: any = null;
  for (const element of elements) {
    if (!element.link || element.isDeleted || element.type === "text") {
      continue;
    }
    if (LINEAR_TYPES.has(element.type)) {
      if (hitLinear(element, p, ARROW_HIT_THRESHOLD / zoom)) {
        bestLinear = element; // last match wins: topmost
      }
    } else if (hitShape(element, p)) {
      const area = Math.abs(element.width * element.height);
      if (area <= bestArea) {
        bestArea = area;
        bestShape = element;
      }
    }
  }
  return bestShape ?? bestLinear;
}
