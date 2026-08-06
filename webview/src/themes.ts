// Theme engine (Phase 6) — visual themes as data, never hard-coded behavior.
// A VisualTheme only changes how things look: defaults applied to newly drawn
// elements (appState.currentItem*) and overlay/selection accents. Interaction
// modes are configured separately (Theme ⊥ Behavior).

export type VisualThemeId = "classic" | "modern" | "figjam" | "autovizerz";

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
}

// Excalidraw FONT_FAMILY values: 2 = Helvetica, 6 = Nunito.
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
  },
};

export function resolveVisualTheme(id: string | undefined): VisualTheme {
  return VISUAL_THEMES[(id as VisualThemeId) ?? "classic"] ?? VISUAL_THEMES.classic;
}
