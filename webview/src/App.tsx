import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  hashElementsVersion,
  loadFromBlob,
  loadLibraryFromBlob,
  serializeLibraryAsJSON,
  THEME,
} from "@excalidraw/excalidraw";

import "@excalidraw/excalidraw/index.css";

import "./styles.css";
import {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { vscode } from "./vscode.ts";
import {
  connectableAt,
  snapToAnchor,
  type Anchor,
  type ConnectDraft,
} from "./connection.ts";
import { ConnectionLayer } from "./ConnectionLayer.tsx";
import { linkedElementAt } from "./hittest.ts";
import {
  applyVisualThemeToElements,
  resolveVisualTheme,
} from "./themes.ts";

// Screen-pixel tolerances for the connection UX (divided by zoom for scene units).
const ANCHOR_HOVER_MARGIN = 8;
const SNAP_DISTANCE = 24;
// A press-release within this many viewport px of the source anchor (or faster
// than CLICK_MAX_MS) keeps the draft alive in click→move→click mode.
const CLICK_SLOP = 8;
const CLICK_MAX_MS = 250;
const FOCUS_HIGHLIGHT_MS = 1500;
const VIEWPORT_REPORT_DEBOUNCE_MS = 300;

interface ElementMetadata {
  ref: string;
  label: string | null;
  link: string;
  x: number;
  y: number;
}

interface ViewportRestore {
  scrollX: number;
  scrollY: number;
  zoom: number;
  center: { x: number; y: number };
}

// "elements/D10.md" -> "D10"; anything else -> null
function refFromLink(link: string): string | null {
  const match = /(?:^|\/)([A-Za-z]+\d+)\.md$/.exec(link);
  return match ? match[1] : null;
}

function detectTheme() {
  switch (document.body.className) {
    case "vscode-dark":
      return THEME.DARK;
    case "vscode-light":
      return THEME.LIGHT;
    default:
      return THEME.LIGHT;
  }
}

function useTheme(initialThemeConfig: string) {
  const [themeConfig, setThemeConfig] = useState(initialThemeConfig);
  const getExcalidrawTheme = () => {
    switch (themeConfig) {
      case "light":
        return THEME.LIGHT;
      case "dark":
        return THEME.DARK;
      case "auto":
        return detectTheme();
    }
  };
  const [theme, setTheme] = useState(getExcalidrawTheme());
  const updateTheme = () => {
    setTheme(getExcalidrawTheme());
  };

  useEffect(updateTheme, [themeConfig]);

  useEffect(() => {
    if (themeConfig !== "auto") return;
    const observer = new MutationObserver(() => {
      updateTheme();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
    };
  }, [themeConfig]);

  return { theme, setThemeConfig };
}

export default function App(props: {
  initialData?: ExcalidrawInitialDataState;
  name: string;
  theme: string;
  visualTheme: string;
  customFeaturesEnabled: boolean;
  initialViewport?: ViewportRestore;
  langCode: string;
  viewModeEnabled: boolean;
  libraryItems?: LibraryItems;
  imageParams: {
    exportBackground: boolean;
    exportWithDarkMode: boolean;
    exportScale: 1 | 2 | 3;
  };
  dirty: boolean;
  onChange: (
    elements: readonly any[],
    appState: Partial<AppState>,
    files?: BinaryFiles
  ) => void;
  sceneVersionRef: { current: number };
}) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI>();
  const libraryItemsRef = useRef(props.libraryItems);
  const { theme, setThemeConfig } = useTheme(props.theme);
  const [imageParams, setImageParams] = useState(props.imageParams);
  const [langCode, setLangCode] = useState(props.langCode);
  const [hoverMetadata, setHoverMetadata] = useState<ElementMetadata | null>(
    null
  );
  const hoveredElementIdRef = useRef<string | null>(null);
  const hoveredVersionNonceRef = useRef<number | null>(null);
  const [hoverAnchorElement, setHoverAnchorElement] = useState<any | null>(null);
  const [visualThemeId, setVisualThemeId] = useState(props.visualTheme);
  const [featuresEnabled, setFeaturesEnabled] = useState(
    props.customFeaturesEnabled
  );
  // Upstream item defaults captured before the first themed override, so the
  // classic theme can restore them exactly instead of guessing.
  const baselineItemDefaultsRef = useRef<Record<string, unknown> | null>(null);
  const [connect, setConnect] = useState<ConnectDraft | null>(null);
  // The wrapper's pointerdown capture handler must see the current draft even
  // though the DOM listener closes over an older render.
  const connectRef = useRef<ConnectDraft | null>(null);
  connectRef.current = connect;
  // Source anchor position in viewport px at draft start, for click-slop.
  const connectOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [, setViewportTick] = useState(0);

  // Interaction state observed from Excalidraw (A3): anchors and tooltips are
  // suppressed while the user drags/resizes/rotates or the context menu is open.
  const [pointerDown, setPointerDown] = useState(false);
  const pointerDownRef = useRef(false);
  const [interactionBusy, setInteractionBusy] = useState(false);
  const interactionBusyRef = useRef(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const contextMenuOpenRef = useRef(false);
  const [handToolActive, setHandToolActive] = useState(false);
  const handToolActiveRef = useRef(false);
  const zoomRef = useRef<number | null>(null);

  // focus-element highlight overlay (no selection → no left style island).
  const [focusHighlight, setFocusHighlight] = useState<{
    ids: string[];
    key: number;
  } | null>(null);
  const focusHighlightTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const focusRequestedRef = useRef(false);
  // A deep link can arrive before the canvas API exists; the ref is held here
  // and applied once it does, rather than dropped.
  const pendingFocusRef = useRef<string | null>(null);
  const didRestoreViewportRef = useRef(false);

  // Arrows already reported to the extension for ref allocation.
  const reportedArrowIdsRef = useRef(new Set<string>());

  const uxOn = featuresEnabled && !props.viewModeEnabled;

  const clearHoverMetadata = () => {
    hoveredElementIdRef.current = null;
    hoveredVersionNonceRef.current = null;
    setHoverMetadata(null);
  };

  // Scene → viewport coordinates for overlay positioning.
  const toViewport = (p: { x: number; y: number }) => {
    if (!excalidrawAPI) {
      return p;
    }
    const appState = excalidrawAPI.getAppState();
    const zoom = appState.zoom.value;
    return {
      x: (p.x + appState.scrollX) * zoom,
      y: (p.y + appState.scrollY) * zoom,
    };
  };

  // Debounced viewport report → extension writes the <file>.viewport.json
  // sidecar (MCP add_element placement + restore on reopen). Not gated by
  // enableCustomFeatures: it serves the MCP contract, not UX.
  const viewportReportTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const canReportViewportRef = useRef(false);
  const reportViewport = () => {
    if (!canReportViewportRef.current) {
      return;
    }
    if (viewportReportTimerRef.current) {
      clearTimeout(viewportReportTimerRef.current);
    }
    viewportReportTimerRef.current = setTimeout(() => {
      viewportReportTimerRef.current = undefined;
      const api = excalidrawAPIRef.current;
      if (!api) {
        return;
      }
      const appState = api.getAppState();
      const zoom = appState.zoom.value;
      if (!zoom || !appState.width || !appState.height) {
        return;
      }
      vscode.postMessage({
        type: "viewport",
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom,
        center: {
          x: appState.width / 2 / zoom - appState.scrollX,
          y: appState.height / 2 / zoom - appState.scrollY,
        },
        width: appState.width,
        height: appState.height,
      });
    }, VIEWPORT_REPORT_DEBOUNCE_MS);
  };

  // Interaction probe (A3), fed from Excalidraw's onChange: cheap ref compares,
  // setState only on transitions.
  const handleAppStateProbe = (appState: any) => {
    const busy = !!(
      appState.selectedElementsAreBeingDragged ||
      appState.isResizing ||
      appState.isRotating
    );
    if (busy !== interactionBusyRef.current) {
      interactionBusyRef.current = busy;
      setInteractionBusy(busy);
      if (busy) {
        clearHoverMetadata();
      }
    }
    const menuOpen = appState.contextMenu != null;
    if (menuOpen !== contextMenuOpenRef.current) {
      contextMenuOpenRef.current = menuOpen;
      setContextMenuOpen(menuOpen);
      if (menuOpen) {
        clearHoverMetadata();
        setHoverAnchorElement(null);
      }
    }
    const isHandTool = appState.activeTool?.type === "hand";
    if (isHandTool !== handToolActiveRef.current) {
      handToolActiveRef.current = isHandTool;
      setHandToolActive(isHandTool);
      if (isHandTool) {
        clearHoverMetadata();
        setHoverAnchorElement(null);
      }
    }
    const zoom = appState.zoom?.value;
    if (zoom && zoom !== zoomRef.current) {
      zoomRef.current = zoom;
      clearHoverMetadata();
      setViewportTick((tick) => tick + 1);
      reportViewport();
    }
  };

  const handlePointerUpdate = ({
    pointer,
    button,
  }: {
    pointer: { x: number; y: number };
    button: "down" | "up";
  }) => {
    if (!excalidrawAPI) {
      return;
    }
    const isDown = button === "down";
    if (isDown !== pointerDownRef.current) {
      pointerDownRef.current = isDown;
      setPointerDown(isDown);
    }
    if (connect) {
      // The draft endpoint is driven by the window pointermove listener.
      return;
    }
    const elements = excalidrawAPI.getSceneElements();
    const pointerZoom = excalidrawAPI.getAppState().zoom.value;

    if (uxOn && !isDown && !interactionBusyRef.current) {
      setHoverAnchorElement(
        connectableAt(elements, pointer, ANCHOR_HOVER_MARGIN / pointerZoom)
      );
    } else if (hoverAnchorElement) {
      setHoverAnchorElement(null);
    }

    if (!featuresEnabled || contextMenuOpenRef.current || isDown) {
      return;
    }
    const hovered = linkedElementAt(elements, pointer, pointerZoom);
    if (
      (hovered?.id ?? null) === hoveredElementIdRef.current &&
      (hovered?.versionNonce ?? null) === hoveredVersionNonceRef.current
    ) {
      return;
    }
    if (!hovered) {
      clearHoverMetadata();
      return;
    }
    const ref = refFromLink(hovered.link);
    if (!ref) {
      clearHoverMetadata();
      return;
    }
    hoveredElementIdRef.current = hovered.id;
    hoveredVersionNonceRef.current = hovered.versionNonce ?? null;
    const appState = excalidrawAPI.getAppState();
    const zoom = appState.zoom.value;
    const boundText = (elements as readonly any[]).find(
      (element) => element.type === "text" && element.containerId === hovered.id
    );
    setHoverMetadata({
      ref,
      label: boundText ? boundText.text : null,
      link: hovered.link,
      x: (hovered.x + hovered.width + appState.scrollX) * zoom + 8,
      y: (hovered.y + appState.scrollY) * zoom,
    });
  };

  const startConnect = (anchor: Anchor) => {
    if (!hoverAnchorElement) {
      return;
    }
    clearHoverMetadata();
    connectOriginRef.current = toViewport(anchor);
    setConnect({
      sourceId: hoverAnchorElement.id,
      sourceAnchor: anchor,
      pointer: { x: anchor.x, y: anchor.y },
      target: null,
      startedAt: Date.now(),
      mode: "drag",
    });
  };

  // Bind an arrow between two anchors. The skeleton converter fills in every
  // editor-owned field; bindings are attached afterwards because the converter
  // only links elements created in the same call, not existing scene elements.
  const createConnection = (draft: ConnectDraft) => {
    if (!excalidrawAPI || !draft.target) {
      return;
    }
    const target = draft.target;
    const elements = excalidrawAPI.getSceneElements();
    const appState = excalidrawAPI.getAppState() as any;
    const dx = target.anchor.x - draft.sourceAnchor.x;
    const dy = target.anchor.y - draft.sourceAnchor.y;
    const [skeleton] = convertToExcalidrawElements([
      {
        type: "arrow",
        x: draft.sourceAnchor.x,
        y: draft.sourceAnchor.y,
        width: Math.abs(dx),
        height: Math.abs(dy),
      } as any,
    ]);
    const arrow: any = {
      ...skeleton,
      points: [
        [0, 0],
        [dx, dy],
      ],
      startBinding: { elementId: draft.sourceId, focus: 0, gap: 4 },
      endBinding: { elementId: target.elementId, focus: 0, gap: 4 },
      // Respect the active visual theme's item defaults (A10).
      strokeColor: appState.currentItemStrokeColor ?? skeleton.strokeColor,
      strokeWidth: appState.currentItemStrokeWidth ?? skeleton.strokeWidth,
      roughness: appState.currentItemRoughness ?? skeleton.roughness,
      roundness: { type: 2 },
      endArrowhead: appState.currentItemEndArrowhead ?? "arrow",
    };
    const boundEntry = { id: arrow.id, type: "arrow" };
    const sourceElement = (elements as readonly any[]).find(
      (element) => element.id === draft.sourceId
    );
    const targetElement = (elements as readonly any[]).find(
      (element) => element.id === target.elementId
    );
    const next = (elements as readonly any[]).map((element) =>
      element.id === draft.sourceId || element.id === target.elementId
        ? {
            ...element,
            boundElements: [...(element.boundElements ?? []), boundEntry],
          }
        : element
    );
    excalidrawAPI.updateScene({
      elements: [...next, arrow],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    // Ask the extension host to allocate a project-wide A# ref and create the
    // elements/A<N>.md doc; it answers with apply-element-link (A9).
    if (!reportedArrowIdsRef.current.has(arrow.id)) {
      reportedArrowIdsRef.current.add(arrow.id);
      vscode.postMessage({
        type: "arrow-created",
        arrowId: arrow.id,
        sourceRef:
          typeof sourceElement?.link === "string"
            ? refFromLink(sourceElement.link)
            : null,
        targetRef:
          typeof targetElement?.link === "string"
            ? refFromLink(targetElement.link)
            : null,
      });
    }
  };

  // While a connection is in progress the canvas must not see pointerdown:
  // in click mode a snapped click completes the arrow, any other click cancels.
  const handlePointerDownCapture = (event: ReactPointerEvent) => {
    const draft = connectRef.current;
    if (!draft) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (draft.mode !== "click") {
      return;
    }
    if (draft.target) {
      createConnection(draft);
    }
    setConnect(null);
  };

  // Drag-to-connect (A5): while a draft exists, window-level listeners drive
  // the endpoint and complete the arrow on mouse release over a target anchor.
  // Excalidraw never saw the initiating pointerdown (the anchor dot swallowed
  // it), so its own onPointerUpdate cannot be relied on during the drag.
  useEffect(() => {
    if (!connect) {
      return;
    }
    const sceneFromClient = (event: PointerEvent) => {
      const api = excalidrawAPIRef.current;
      if (!api) {
        return null;
      }
      const appState = api.getAppState();
      const zoom = appState.zoom.value;
      return {
        x: event.clientX / zoom - appState.scrollX,
        y: event.clientY / zoom - appState.scrollY,
        zoom,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      const scene = sceneFromClient(event);
      const api = excalidrawAPIRef.current;
      if (!scene || !api) {
        return;
      }
      setConnect((draft) =>
        draft
          ? {
              ...draft,
              pointer: { x: scene.x, y: scene.y },
              target: snapToAnchor(
                api.getSceneElements(),
                { x: scene.x, y: scene.y },
                draft.sourceId,
                SNAP_DISTANCE / scene.zoom
              ),
            }
          : draft
      );
    };
    const onPointerUp = (event: PointerEvent) => {
      const draft = connectRef.current;
      if (!draft || draft.mode === "click") {
        return;
      }
      if (draft.target) {
        createConnection(draft);
        setConnect(null);
        return;
      }
      const origin = connectOriginRef.current;
      const nearOrigin =
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <=
          CLICK_SLOP;
      if (nearOrigin || Date.now() - draft.startedAt < CLICK_MAX_MS) {
        // Quick press-release on the source anchor → click→move→click mode.
        setConnect({ ...draft, mode: "click" });
        return;
      }
      setConnect(null);
    };
    const cancel = () => setConnect(null);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [connect === null]);

  // Apply the visual theme: item defaults for new elements plus a restyle of
  // existing elements (snapshot/restore via customData.avBaseStyle). With the
  // feature gate off, the classic theme is enforced so everything restores.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const visualTheme = resolveVisualTheme(
      featuresEnabled ? visualThemeId : "classic"
    );
    const appState = excalidrawAPI.getAppState() as any;
    if (!baselineItemDefaultsRef.current) {
      baselineItemDefaultsRef.current = {
        currentItemRoundness: appState.currentItemRoundness,
        currentItemStrokeWidth: appState.currentItemStrokeWidth,
        currentItemFontFamily: appState.currentItemFontFamily,
        currentItemArrowType: appState.currentItemArrowType,
        currentItemStrokeColor: appState.currentItemStrokeColor,
        currentItemBackgroundColor: appState.currentItemBackgroundColor,
      };
    }
    excalidrawAPI.updateScene({
      appState: {
        ...baselineItemDefaultsRef.current,
        ...visualTheme.currentItem,
      } as any,
    });
    const styled = applyVisualThemeToElements(
      excalidrawAPI.getSceneElements(),
      visualTheme
    );
    if (styled) {
      excalidrawAPI.updateScene({
        elements: styled,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      excalidrawAPI.refresh();
    }
  }, [excalidrawAPI, visualThemeId, featuresEnabled]);

  // Feature gate turned off mid-session: drop every transient overlay and
  // restore the native link icons (the vite build patches Excalidraw to honor
  // this global; see webview/vite.config.ts).
  useEffect(() => {
    (globalThis as any).__AV_SHOW_LINK_ICONS = !featuresEnabled;
    excalidrawAPI?.refresh();
    if (!featuresEnabled) {
      setConnect(null);
      setHoverAnchorElement(null);
      clearHoverMetadata();
      setFocusHighlight(null);
    }
  }, [excalidrawAPI, featuresEnabled]);

  // Scroll to an element and flag it. Shared by the focus-element message and
  // the pending-focus replay below, so a deep link that lands before the canvas
  // is ready behaves identically to one that lands after.
  const applyFocus = (ref: string) => {
    if (!excalidrawAPI) {
      return;
    }
    const elements = excalidrawAPI.getSceneElements();
    const matched = elements.filter(
      (element: any) =>
        element.id === ref ||
        (typeof element.link === "string" &&
          (element.link === `elements/${ref}.md` ||
            element.link.endsWith(`/${ref}.md`)))
    );
    if (matched.length === 0) {
      vscode.postMessage({
        type: "info",
        content: `Element "${ref}" was not found in this diagram`,
      });
      return;
    }
    if (featuresEnabled) {
      // Transient highlight instead of selection, so the left style
      // island stays closed (item 6).
      if (focusHighlightTimerRef.current) {
        clearTimeout(focusHighlightTimerRef.current);
      }
      setFocusHighlight({
        ids: matched.map((element: any) => element.id),
        key: Date.now(),
      });
      focusHighlightTimerRef.current = setTimeout(() => {
        focusHighlightTimerRef.current = undefined;
        setFocusHighlight(null);
      }, FOCUS_HIGHLIGHT_MS);
    } else {
      excalidrawAPI.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(
            matched.map((element: any) => [element.id, true])
          ),
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    excalidrawAPI.scrollToContent(matched, {
      fitToViewport: false,
      animate: true,
      duration: 300,
    });
  };

  // Replay a deep link that arrived before the canvas API existed.
  useEffect(() => {
    const ref = pendingFocusRef.current;
    if (!excalidrawAPI || !ref) {
      return;
    }
    pendingFocusRef.current = null;
    applyFocus(ref);
  }, [excalidrawAPI, featuresEnabled]);

  // One-shot viewport restore (item 14) + initial viewport report. Deep-link
  // focus wins: if focus-element already arrived, restore is skipped.
  useEffect(() => {
    if (!excalidrawAPI || didRestoreViewportRef.current) {
      return;
    }
    didRestoreViewportRef.current = true;
    const willRestore =
      !!props.initialViewport &&
      featuresEnabled &&
      !focusRequestedRef.current;
    if (willRestore) {
      const appState = excalidrawAPI.getAppState();
      const width = appState.width || window.innerWidth;
      const height = appState.height || window.innerHeight;
      const { zoom, center } = props.initialViewport!;
      excalidrawAPI.updateScene({
        appState: {
          scrollX: width / 2 / zoom - center.x,
          scrollY: height / 2 / zoom - center.y,
          zoom: { value: zoom },
        } as any,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    // Enable viewport reporting now that restore has been attempted.
    canReportViewportRef.current = true;
    // Report only once the viewport is final. Reporting the default viewport
    // while a saved one exists would overwrite the sidecar with 0,0 — the way
    // a reopen used to destroy the position it was supposed to restore. When a
    // focus is pending, that focus reports the viewport it lands on.
    if (willRestore || !props.initialViewport) {
      reportViewport();
    }
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!connect) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setConnect(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [connect === null]);

  useEffect(() => {
    if (!props.dirty) {
      return;
    }
    if (props.initialData) {
      const { elements, appState, files } = props.initialData;
      props.onChange(elements || [], appState || {}, files);
    } else {
      props.onChange([], { viewBackgroundColor: "#ffffff" }, {});
    }
  }, []);

  useEffect(() => {
    const listener = async (e: any) => {
      try {
        const message = e.data;
        switch (message.type) {
          case "library-change": {
            const blob = new Blob([message.library], {
              type: "application/json",
            });
            const libraryItems = await loadLibraryFromBlob(blob);
            if (
              JSON.stringify(libraryItems) ==
              JSON.stringify(libraryItemsRef.current)
            ) {
              return;
            }
            libraryItemsRef.current = libraryItems;
            excalidrawAPI?.updateLibrary({
              libraryItems,
              merge: message.merge,
              openLibraryMenu: !message.merge,
            });
            break;
          }
          case "theme-change": {
            setThemeConfig(message.theme);
            break;
          }
          case "visual-theme-change": {
            setVisualThemeId(message.visualTheme);
            break;
          }
          case "custom-features-change": {
            setFeaturesEnabled(message.enabled);
            break;
          }
          case "language-change": {
            setLangCode(message.langCode);
            break;
          }
          case "image-params-change": {
            setImageParams(message.imageParams);
            break;
          }
          case "document-change": {
            if (!excalidrawAPI) {
              return;
            }
            const blob = new Blob(
              [new TextDecoder().decode(new Uint8Array(message.content))],
              { type: "application/json" }
            );
            const scene = await loadFromBlob(blob, null, null);
            const elements = scene.elements || [];
            // Prevent the change from echoing back to VS Code as an edit.
            props.sceneVersionRef.current = hashElementsVersion(elements);
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            if (scene.files) {
              excalidrawAPI.addFiles(Object.values(scene.files));
            }
            // Elements added externally (e.g. by the MCP) arrive unstyled —
            // re-apply the active theme. applyVisualThemeToElements is
            // idempotent, so this converges instead of looping.
            if (featuresEnabled) {
              const styled = applyVisualThemeToElements(
                elements,
                resolveVisualTheme(visualThemeId)
              );
              if (styled) {
                excalidrawAPI.updateScene({
                  elements: styled,
                  captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                });
                excalidrawAPI.refresh();
              }
            }
            break;
          }
          case "apply-element-link": {
            if (!excalidrawAPI) {
              return;
            }
            const elements = excalidrawAPI.getSceneElements();
            if (
              !(elements as readonly any[]).some(
                (element) =>
                  element.id === message.elementId && !element.isDeleted
              )
            ) {
              // Arrow already gone — the orphan doc file is harmless.
              return;
            }
            excalidrawAPI.updateScene({
              elements: (elements as readonly any[]).map((element) =>
                element.id === message.elementId
                  ? { ...element, link: message.link }
                  : element
              ),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            break;
          }
          case "focus-element": {
            focusRequestedRef.current = true;
            const ref: string = message.ref;
            if (!excalidrawAPI) {
              // Hold it: dropping the link here also left viewport restore
              // permanently suppressed for this mount.
              pendingFocusRef.current = ref;
              return;
            }
            applyFocus(ref);
            break;
          }
        }
      } catch (e) {
        vscode.postMessage({
          type: "error",
          content: (e as Error).message,
        });
      }
    };
    window.addEventListener("message", listener);

    return () => {
      window.removeEventListener("message", listener);
    };
  }, [excalidrawAPI, featuresEnabled, visualThemeId]);

  const accentColor = resolveVisualTheme(visualThemeId).accentColor;

  const showAnchors =
    uxOn && !connect && !interactionBusy && !contextMenuOpen && !pointerDown && !handToolActive;

  const focusHighlightZoom = excalidrawAPI
    ? excalidrawAPI.getAppState().zoom.value
    : 1;

  return (
    <div
      className="excalidraw-wrapper"
      data-visual-theme={visualThemeId}
      style={
        accentColor
          ? ({
              "--av-accent": accentColor,
              "--color-selection": accentColor,
            } as CSSProperties)
          : undefined
      }
      onPointerDownCapture={handlePointerDownCapture}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          excalidrawAPIRef.current = api;
          setExcalidrawAPI(api);
        }}
        onPointerUpdate={handlePointerUpdate}
        onScrollChange={() => {
          clearHoverMetadata();
          // Overlays position off appState scroll/zoom — force a re-render.
          setViewportTick((tick) => tick + 1);
          reportViewport();
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
        langCode={langCode}
        name={props.name}
        theme={theme}
        viewModeEnabled={props.viewModeEnabled}
        initialData={{
          ...props.initialData,
          libraryItems: props.libraryItems,
          scrollToContent: !(
            props.initialViewport && props.customFeaturesEnabled
          ),
        }}
        libraryReturnUrl={"vscode://autovizerz.excalidraw-editor/importLib"}
        onChange={(elements, appState, files) => {
          handleAppStateProbe(appState);
          props.onChange(
            elements,
            { ...appState, ...imageParams, exportEmbedScene: true },
            files
          );
        }}
        onLinkOpen={(element, event) => {
          vscode.postMessage({
            type: "link-open",
            url: element.link,
          });
          event.preventDefault();
        }}
        onLibraryChange={(libraryItems) => {
          if (
            JSON.stringify(libraryItems) ==
            JSON.stringify(libraryItemsRef.current)
          ) {
            return;
          }
          libraryItemsRef.current = libraryItems;
          vscode.postMessage({
            type: "library-change",
            library: serializeLibraryAsJSON(libraryItems),
          });
        }}
      />
      {uxOn && excalidrawAPI && (
        <ConnectionLayer
          hovered={showAnchors ? hoverAnchorElement : null}
          connect={connect}
          toViewport={toViewport}
          onStartConnect={startConnect}
        />
      )}
      {featuresEnabled && hoverMetadata && !contextMenuOpen && (
        <div
          className={`element-metadata-popover ${
            theme === THEME.DARK ? "theme--dark" : ""
          }`}
          style={{ left: hoverMetadata.x, top: hoverMetadata.y }}
        >
          <div className="element-metadata-ref">{hoverMetadata.ref}</div>
          {hoverMetadata.label && (
            <div className="element-metadata-label">{hoverMetadata.label}</div>
          )}
        </div>
      )}
      {focusHighlight &&
        excalidrawAPI &&
        focusHighlight.ids.map((id) => {
          const element = (
            excalidrawAPI.getSceneElements() as readonly any[]
          ).find((candidate) => candidate.id === id && !candidate.isDeleted);
          if (!element) {
            return null;
          }
          const pos = toViewport({ x: element.x, y: element.y });
          return (
            <div
              key={`${focusHighlight.key}-${id}`}
              className="focus-highlight"
              style={{
                left: pos.x,
                top: pos.y,
                width: element.width * focusHighlightZoom,
                height: element.height * focusHighlightZoom,
                transform: element.angle
                  ? `rotate(${element.angle}rad)`
                  : undefined,
              }}
            />
          );
        })}
    </div>
  );
}
