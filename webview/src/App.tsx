import { useEffect, useState, useRef } from "react";
import {
  CaptureUpdateAction,
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

  const clearHoverMetadata = () => {
    hoveredElementIdRef.current = null;
    setHoverMetadata(null);
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
    <div className="excalidraw-wrapper">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onPointerUpdate={handlePointerUpdate}
        onScrollChange={clearHoverMetadata}
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
      {hoverMetadata && (
        <div
          className="element-metadata-popover"
          style={{ left: hoverMetadata.x, top: hoverMetadata.y }}
        >
          <div className="element-metadata-ref">{hoverMetadata.ref}</div>
          {hoverMetadata.label && (
            <div className="element-metadata-label">{hoverMetadata.label}</div>
          )}
          <div className="element-metadata-link">{hoverMetadata.link}</div>
          <button
            className="element-metadata-open"
            onClick={() => {
              vscode.postMessage({
                type: "link-open",
                url: hoverMetadata.link,
              });
            }}
          >
            Open →
          </button>
        </div>
      )}
    </div>
  );
}
