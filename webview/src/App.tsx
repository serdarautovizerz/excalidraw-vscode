import {
  useEffect,
  useState,
  useRef,
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

// Screen-pixel tolerances for the connection UX (divided by zoom for scene units).
const ANCHOR_HOVER_MARGIN = 8;
const SNAP_DISTANCE = 24;

interface ElementMetadata {
  ref: string;
  label: string | null;
  link: string;
  x: number;
  y: number;
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
  const libraryItemsRef = useRef(props.libraryItems);
  const { theme, setThemeConfig } = useTheme(props.theme);
  const [imageParams, setImageParams] = useState(props.imageParams);
  const [langCode, setLangCode] = useState(props.langCode);
  const [hoverMetadata, setHoverMetadata] = useState<ElementMetadata | null>(
    null
  );
  const hoveredElementIdRef = useRef<string | null>(null);
  const [hoverAnchorElement, setHoverAnchorElement] = useState<any | null>(null);
  const [connect, setConnect] = useState<ConnectDraft | null>(null);
  // The wrapper's pointerdown capture handler must see the current draft even
  // though the DOM listener closes over an older render.
  const connectRef = useRef<ConnectDraft | null>(null);
  connectRef.current = connect;
  const [, setViewportTick] = useState(0);

  const clearHoverMetadata = () => {
    hoveredElementIdRef.current = null;
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

  const handlePointerUpdate = ({
    pointer,
  }: {
    pointer: { x: number; y: number };
  }) => {
    if (!excalidrawAPI) {
      return;
    }
    const elements = excalidrawAPI.getSceneElements();
    const pointerZoom = excalidrawAPI.getAppState().zoom.value;

    if (connect) {
      // Endpoint follows the pointer; snaps to the nearest foreign anchor.
      setConnect({
        ...connect,
        pointer,
        target: snapToAnchor(
          elements,
          pointer,
          connect.sourceId,
          SNAP_DISTANCE / pointerZoom
        ),
      });
      return;
    }

    if (!props.viewModeEnabled) {
      setHoverAnchorElement(
        connectableAt(elements, pointer, ANCHOR_HOVER_MARGIN / pointerZoom)
      );
    }
    let hovered: any = null;
    for (const element of elements as readonly any[]) {
      if (!element.link || element.type === "text") {
        continue;
      }
      if (
        pointer.x >= element.x &&
        pointer.x <= element.x + element.width &&
        pointer.y >= element.y &&
        pointer.y <= element.y + element.height
      ) {
        // Last match wins: highest z-order.
        hovered = element;
      }
    }
    if ((hovered?.id ?? null) === hoveredElementIdRef.current) {
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
    setConnect({
      sourceId: hoverAnchorElement.id,
      sourceAnchor: anchor,
      pointer: { x: anchor.x, y: anchor.y },
      target: null,
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
    const dx = target.anchor.x - draft.sourceAnchor.x;
    const dy = target.anchor.y - draft.sourceAnchor.y;
    const [skeleton] = convertToExcalidrawElements([
      {
        type: "arrow",
        x: draft.sourceAnchor.x,
        y: draft.sourceAnchor.y,
        width: dx,
        height: dy,
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
    };
    const boundEntry = { id: arrow.id, type: "arrow" };
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
  };

  // While a connection is in progress the canvas must not see pointerdown:
  // a snapped click completes the arrow, any other click cancels.
  const handlePointerDownCapture = (event: ReactPointerEvent) => {
    const draft = connectRef.current;
    if (!draft) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (draft.target) {
      createConnection(draft);
    }
    setConnect(null);
  };

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
            break;
          }
          case "focus-element": {
            if (!excalidrawAPI) {
              return;
            }
            const ref: string = message.ref;
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
            excalidrawAPI.updateScene({
              appState: {
                selectedElementIds: Object.fromEntries(
                  matched.map((element: any) => [element.id, true])
                ),
              },
            });
            excalidrawAPI.scrollToContent(matched, {
              fitToViewport: false,
              animate: true,
              duration: 300,
            });
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
  }, [excalidrawAPI]);

  return (
    <div
      className="excalidraw-wrapper"
      onPointerDownCapture={handlePointerDownCapture}
    >
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onPointerUpdate={handlePointerUpdate}
        onScrollChange={() => {
          clearHoverMetadata();
          // Overlays position off appState scroll/zoom — force a re-render.
          setViewportTick((tick) => tick + 1);
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
          scrollToContent: true,
        }}
        libraryReturnUrl={"vscode://pomdtr.excalidraw-editor/importLib"}
        onChange={(elements, appState, files) =>
          props.onChange(
            elements,
            { ...appState, ...imageParams, exportEmbedScene: true },
            files
          )
        }
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
      {!props.viewModeEnabled && excalidrawAPI && (
        <ConnectionLayer
          hovered={connect ? null : hoverAnchorElement}
          connect={connect}
          toViewport={toViewport}
          onStartConnect={startConnect}
        />
      )}
      {hoverMetadata && (
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
    </div>
  );
}
