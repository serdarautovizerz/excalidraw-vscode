// Theme engine (Phase 6) — visual themes as data, never hard-coded behavior.
// A VisualTheme only changes how things look: defaults applied to newly drawn
// elements (appState.currentItem*) and overlay/selection accents. Interaction
// modes are configured separately (Theme ⊥ Behavior).

export type VisualThemeId =
  | "classic"
  | "modern"
  | "figjam"
  | "autovizerz"
  | "cath";

// Style overrides applied to EXISTING elements when a theme is active.
// Only the listed keys are touched; originals are snapshotted per element in
// customData.avBaseStyle so the classic theme can restore them exactly.
interface ShapeStyle {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  roundness?: { type: number } | null;
}

interface ArrowStyle {
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  roundness?: { type: number } | null;
  endArrowhead?: string;
}

interface TextStyle {
  strokeColor?: string;
  fontFamily?: number;
  fontSize?: number;
}

// Where a text element lives: bound to an arrow (transition label), bound to a
// shape (state / decision / terminator label), or free-standing ("none").
export type TextContainerKind =
  | "arrow"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "none";

export interface ElementStyles {
  shape?: ShapeStyle;
  byType?: Partial<Record<"rectangle" | "diamond" | "ellipse", ShapeStyle>>;
  arrow?: ArrowStyle;
  text?: TextStyle;
  // Per-container refinements merged over `text`, so a theme can give arrow
  // labels a different voice (mono, muted) than state names (sans, ink).
  textByContainer?: Partial<Record<TextContainerKind, TextStyle>>;
}

export interface VisualTheme {
  id: VisualThemeId;
  // Defaults for newly drawn elements; merged into appState. Empty for the
  // classic theme so upstream Excalidraw defaults stay untouched.
  currentItem: {
    currentItemRoundness?: "round" | "sharp";
    currentItemStrokeWidth?: number;
    currentItemFontFamily?: number;
    currentItemArrowType?: "sharp" | "round" | "elbow";
    currentItemStrokeColor?: string;
    currentItemBackgroundColor?: string;
  };
  // Accent for selection outline and connection anchors (CSS layer).
  accentColor?: string;
  // Canvas "paper" color (appState.viewBackgroundColor). Optional: themes that
  // rely on white cards sitting on off-white paper set it; the others leave the
  // document's own background alone.
  canvasBackground?: string;
  // Geometry of the open "arrow" head — arm length in scene px and half-angle
  // in degrees. Render-only (a vite build patch lets Excalidraw read it; see
  // webview/vite.config.ts). Absent = Excalidraw's own 25px / 20°.
  arrowhead?: { size: number; angle: number };
  // Restyle rules for elements already on the canvas. Absent for classic,
  // which instead restores each element's snapshotted base style.
  elementStyles?: ElementStyles;
}

// Excalidraw FONT_FAMILY values: 2 = Helvetica, 3 = Cascadia (mono), 6 = Nunito.
export const VISUAL_THEMES: Record<VisualThemeId, VisualTheme> = {
  // Upstream Excalidraw exactly as shipped.
  classic: {
    id: "classic",
    currentItem: {},
  },
  // Clean technical diagrams: thin strokes, straight text, soft corners.
  modern: {
    id: "modern",
    currentItem: {
      currentItemRoundness: "round",
      currentItemStrokeWidth: 1,
      currentItemFontFamily: 2,
      currentItemArrowType: "round",
      currentItemStrokeColor: "#1e1e1e",
    },
    accentColor: "#4c6ef5",
    elementStyles: {
      shape: {
        strokeColor: "#1e1e1e",
        strokeWidth: 1,
        roughness: 0,
        roundness: { type: 3 },
      },
      arrow: {
        strokeColor: "#1e1e1e",
        strokeWidth: 1,
        roughness: 0,
        roundness: { type: 2 },
        endArrowhead: "arrow",
      },
      text: { fontFamily: 2 },
    },
  },
  // Inspired by FigJam's interaction patterns — original identity, not a clone.
  figjam: {
    id: "figjam",
    currentItem: {
      currentItemRoundness: "round",
      currentItemStrokeWidth: 2,
      currentItemFontFamily: 6,
      currentItemArrowType: "elbow",
      currentItemStrokeColor: "#343a40",
      currentItemBackgroundColor: "#e7f5ff",
    },
    accentColor: "#ae3ec9",
    elementStyles: {
      shape: {
        strokeColor: "#343a40",
        backgroundColor: "#e7f5ff",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 0,
        roundness: { type: 3 },
      },
      byType: {
        diamond: { backgroundColor: "#fff9db" },
        ellipse: { backgroundColor: "#e6fcf5" },
      },
      arrow: {
        strokeColor: "#343a40",
        strokeWidth: 2,
        roughness: 0,
        roundness: { type: 2 },
        endArrowhead: "triangle",
      },
      text: { strokeColor: "#343a40", fontFamily: 6 },
    },
  },
  // AutoVizerz brand look for the state-machine diagrams.
  autovizerz: {
    id: "autovizerz",
    currentItem: {
      currentItemRoundness: "round",
      currentItemStrokeWidth: 2,
      currentItemFontFamily: 2,
      currentItemArrowType: "round",
      currentItemStrokeColor: "#0f172a",
      currentItemBackgroundColor: "#e0f2fe",
    },
    accentColor: "#0e7490",
    elementStyles: {
      shape: {
        strokeColor: "#0f172a",
        backgroundColor: "#e0f2fe",
        fillStyle: "solid",
        strokeWidth: 2,
        roundness: { type: 3 },
      },
      byType: {
        diamond: { backgroundColor: "#fef9c3" },
        ellipse: { backgroundColor: "#dcfce7" },
      },
      arrow: {
        strokeColor: "#0e7490",
        strokeWidth: 2,
        roundness: { type: 2 },
        endArrowhead: "arrow",
      },
      text: { fontFamily: 2 },
    },
  },
  // Editorial state-machine look after cathrynlavery/diagram-design
  // (references/style-guide.md): white-smoke paper, jet-black ink, blue-slate
  // muted, one atomic-tangerine accent. Hairline strokes, no roughness, white
  // cards on off-white paper; state names in sans, transition labels in mono;
  // terminators are solid ink (the "filled start dot"). The accent is reserved
  // for selection/anchors and the one focal element a user picks by hand.
  cath: {
    id: "cath",
    currentItem: {
      currentItemRoundness: "round",
      currentItemStrokeWidth: 2,
      currentItemFontFamily: 3,
      currentItemArrowType: "round",
      currentItemStrokeColor: "#4f5d75",
      currentItemBackgroundColor: "#ffffff",
    },
    accentColor: "#eb6c36",
    canvasBackground: "#f5f5f5",
    // Short, wide chevron (like a "›" glyph) instead of Excalidraw's long
    // narrow one, so the head reads as bold as the width-2 shaft.
    arrowhead: { size: 14, angle: 40 },
    // One voice for every stroke and label: the blue-slate muted token at
    // width 2 — shapes, transitions and text all share it; terminators are
    // solid slate with paper-colored labels.
    elementStyles: {
      shape: {
        strokeColor: "#4f5d75",
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        roundness: { type: 3 },
      },
      byType: {
        diamond: { roundness: { type: 2 } },
        ellipse: { backgroundColor: "#4f5d75", roundness: { type: 2 } },
      },
      // Transitions: a heavier slate shaft with an open chevron head (the
      // Excalidraw "arrow" head), so they read clearly against hairline cards.
      arrow: {
        strokeColor: "#4f5d75",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        roundness: { type: 2 },
        endArrowhead: "arrow",
      },
      // Every label in Cascadia (mono); only transition labels are smaller.
      text: { strokeColor: "#4f5d75", fontFamily: 3 },
      textByContainer: {
        arrow: { fontSize: 16 },
        ellipse: { strokeColor: "#f5f5f5" },
      },
    },
  },
};

// ─── Restyle engine ──────────────────────────────────────────────────────────

const SHAPE_TYPES = new Set(["rectangle", "diamond", "ellipse"]);

const SHAPE_STYLE_KEYS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
] as const;
const ARROW_STYLE_KEYS = [
  "strokeColor",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
  "endArrowhead",
] as const;
const TEXT_STYLE_KEYS = ["strokeColor", "fontFamily", "fontSize"] as const;

function styleKeysFor(element: any): readonly string[] | null {
  if (SHAPE_TYPES.has(element.type)) {
    return SHAPE_STYLE_KEYS;
  }
  if (element.type === "arrow") {
    return ARROW_STYLE_KEYS;
  }
  if (element.type === "text") {
    return TEXT_STYLE_KEYS;
  }
  return null;
}

function textContainerKind(
  element: any,
  typeById: Map<string, string>
): TextContainerKind {
  const containerType = element.containerId
    ? typeById.get(element.containerId)
    : undefined;
  if (containerType === "arrow") {
    return "arrow";
  }
  if (containerType && SHAPE_TYPES.has(containerType)) {
    return containerType as TextContainerKind;
  }
  return "none";
}

function targetStyleFor(
  element: any,
  styles: ElementStyles,
  typeById: Map<string, string>
): Record<string, unknown> | null {
  if (SHAPE_TYPES.has(element.type)) {
    const byType = styles.byType?.[element.type as "rectangle"];
    return styles.shape || byType ? { ...styles.shape, ...byType } : null;
  }
  if (element.type === "arrow") {
    return styles.arrow ? { ...styles.arrow } : null;
  }
  if (element.type === "text") {
    const byContainer =
      styles.textByContainer?.[textContainerKind(element, typeById)];
    return styles.text || byContainer
      ? { ...styles.text, ...byContainer }
      : null;
  }
  return null;
}

function sameStyleValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function bumpVersion(element: any): any {
  return {
    ...element,
    version: (element.version ?? 1) + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
}

/**
 * Restyle existing elements for a theme, snapshotting each element's original
 * style into customData.avBaseStyle the first time it is themed. The classic
 * theme (or a disabled feature gate) restores the snapshot and removes it.
 * Elements first drawn under a theme have that look snapshotted as their base.
 * Returns the new element array, or null when nothing changed (idempotent, so
 * repeated application never causes save loops).
 */
export function applyVisualThemeToElements(
  elements: readonly any[],
  theme: VisualTheme
): any[] | null {
  let changed = false;
  // Container lookup for bound text (arrow label vs. shape label).
  const typeById = new Map<string, string>();
  for (const element of elements) {
    typeById.set(element.id, element.type);
  }
  const next = elements.map((element: any) => {
    if (element.isDeleted) {
      return element;
    }
    const keys = styleKeysFor(element);
    if (!keys) {
      return element;
    }

    if (theme.id === "classic" || !theme.elementStyles) {
      const base = element.customData?.avBaseStyle;
      if (!base) {
        return element;
      }
      const restored: any = { ...element };
      for (const key of keys) {
        if (key in base) {
          restored[key] = base[key];
        }
      }
      const customData = { ...element.customData };
      delete customData.avBaseStyle;
      delete customData.avTheme;
      restored.customData = Object.keys(customData).length
        ? customData
        : undefined;
      changed = true;
      return bumpVersion(restored);
    }

    const target = targetStyleFor(element, theme.elementStyles, typeById);
    if (!target || Object.keys(target).length === 0) {
      return element;
    }
    const alreadyThemed =
      element.customData?.avTheme === theme.id &&
      Object.entries(target).every(([key, value]) =>
        sameStyleValue(element[key], value)
      );
    if (alreadyThemed) {
      return element;
    }
    // Snapshot the original style. A snapshot taken by an older build may
    // lack keys added since (e.g. fontSize); those are still untouched on the
    // element, so backfill them from it — the existing snapshot wins for the
    // keys it has.
    const base = {
      ...Object.fromEntries(keys.map((key) => [key, element[key] ?? null])),
      ...element.customData?.avBaseStyle,
    };
    const styled: any = {
      ...element,
      ...target,
      customData: {
        ...element.customData,
        avBaseStyle: base,
        avTheme: theme.id,
      },
    };
    changed = true;
    return bumpVersion(styled);
  });
  return changed ? next : null;
}

export function resolveVisualTheme(id: string | undefined): VisualTheme {
  return VISUAL_THEMES[(id as VisualThemeId) ?? "classic"] ?? VISUAL_THEMES.classic;
}
