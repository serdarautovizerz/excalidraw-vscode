import * as vscode from "vscode";
import * as path from "path";
import { Base64 } from "js-base64";

import { ExcalidrawDocument } from "./document";
import { languageMap } from "./lang";
import { showEditor } from "./commands";
import { ExcalidrawBridge, BridgeMessage } from "./bridge";
import { allocateArrowRef } from "./refs";

// Viewport sidecar (<file>.viewport.json): written beside the diagram so the
// AutoVizerz diagram MCP can place add_element at the current viewport center
// and so the viewport can be restored when the file is reopened.
interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
  center: { x: number; y: number };
  width: number;
  height: number;
}

const VIEWPORT_WRITE_DEBOUNCE_MS = 500;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export class ExcalidrawEditorProvider
  implements vscode.CustomEditorProvider<ExcalidrawDocument>
{
  public static async register(
    context: vscode.ExtensionContext
  ): Promise<vscode.Disposable> {
    const provider = new ExcalidrawEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      ExcalidrawEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      }
    );

    ExcalidrawEditorProvider.migrateLegacyLibraryItems(context);

    return providerRegistration;
  }

  private static migrateLegacyLibraryItems(context: vscode.ExtensionContext) {
    const libraryItems = context.globalState.get("libraryItems");
    if (!libraryItems) {
      return;
    }
    context.globalState
      .update(
        "library",
        JSON.stringify({
          type: "excalidrawlib",
          version: 2,
          source:
            "https://marketplace.visualstudio.com/items?itemName=autovizerz.excalidraw-editor",
          libraryItems,
        })
      )
      .then(() => {
        context.globalState.update("libraryItems", undefined);
      });
  }

  private static readonly viewType = "editor.excalidraw";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomEditor(
    document: ExcalidrawDocument,
    webviewPanel: vscode.WebviewPanel
  ) {
    const editor = new ExcalidrawEditor(
      document,
      webviewPanel.webview,
      this.context
    );
    const editorDisposable = await editor.setupWebview();
    const bridgeDisposable = ExcalidrawBridge.register(editor, webviewPanel);

    webviewPanel.onDidDispose(() => {
      bridgeDisposable.dispose();
      editorDisposable.dispose();
    });
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<ExcalidrawDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  async backupCustomDocument(
    document: ExcalidrawDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    return document.backup(context.destination);
  }

  // TODO: Backup Support
  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<ExcalidrawDocument> {
    let content: Uint8Array;
    if (uri.scheme === "untitled") {
      content = new TextEncoder().encode(
        JSON.stringify({ type: "excalidraw", elements: [] })
      );
    } else {
      content = await vscode.workspace.fs.readFile(
        openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri
      );
    }
    const document = new ExcalidrawDocument(uri, content);

    const onDidDocumentChange = document.onDidContentChange(() => {
      this._onDidChangeCustomDocument.fire({ document });
    });

    document.onDidDispose(() => {
      onDidDocumentChange.dispose();
    });

    return document;
  }

  revertCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.revert();
  }

  saveCustomDocument(document: ExcalidrawDocument): Thenable<void> {
    return document.save();
  }

  async saveCustomDocumentAs(
    document: ExcalidrawDocument,
    destination: vscode.Uri
  ) {
    await document.saveAs(destination);
  }
}

export class ExcalidrawEditor {
  // Allows to pass events between editors
  private static _onDidChangeLibrary = new vscode.EventEmitter<string>();
  private static onDidChangeLibrary =
    ExcalidrawEditor._onDidChangeLibrary.event;
  private static _onLibraryImport = new vscode.EventEmitter<{
    library: string;
  }>();
  private static onLibraryImport = ExcalidrawEditor._onLibraryImport.event;
  private textDecoder = new TextDecoder();

  constructor(
    readonly document: ExcalidrawDocument,
    readonly webview: vscode.Webview,
    readonly context: vscode.ExtensionContext
  ) {}

  private pendingViewport: ViewportState | undefined;
  private viewportWriteTimer: ReturnType<typeof setTimeout> | undefined;

  private get viewportSidecarUri(): vscode.Uri {
    return this.document.uri.with({
      path: this.document.uri.path + ".viewport.json",
    });
  }

  private scheduleViewportWrite(viewport: ViewportState) {
    this.pendingViewport = viewport;
    if (this.viewportWriteTimer) {
      clearTimeout(this.viewportWriteTimer);
    }
    this.viewportWriteTimer = setTimeout(() => {
      this.viewportWriteTimer = undefined;
      this.flushViewportWrite();
    }, VIEWPORT_WRITE_DEBOUNCE_MS);
  }

  private flushViewportWrite() {
    const viewport = this.pendingViewport;
    if (!viewport) {
      return;
    }
    this.pendingViewport = undefined;
    const payload = {
      file: this.document.uri.fsPath,
      center: viewport.center,
      zoom: viewport.zoom,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      updatedAt: new Date().toISOString(),
    };
    // Fire and forget — a sidecar write must never surface an error.
    vscode.workspace.fs
      .writeFile(
        this.viewportSidecarUri,
        new TextEncoder().encode(JSON.stringify(payload, null, 2))
      )
      .then(undefined, () => undefined);
  }

  private async readViewportSidecar(): Promise<
    | { scrollX: number; scrollY: number; zoom: number; center: { x: number; y: number } }
    | undefined
  > {
    try {
      const raw = this.textDecoder.decode(
        await vscode.workspace.fs.readFile(this.viewportSidecarUri)
      );
      const parsed = JSON.parse(raw);
      if (
        isFiniteNumber(parsed?.zoom) &&
        parsed.zoom >= 0.05 &&
        parsed.zoom <= 30 &&
        isFiniteNumber(parsed?.scrollX) &&
        isFiniteNumber(parsed?.scrollY) &&
        isFiniteNumber(parsed?.center?.x) &&
        isFiniteNumber(parsed?.center?.y)
      ) {
        return {
          scrollX: parsed.scrollX,
          scrollY: parsed.scrollY,
          zoom: parsed.zoom,
          center: { x: parsed.center.x, y: parsed.center.y },
        };
      }
    } catch {
      // Missing or corrupt sidecar — no restore.
    }
    return undefined;
  }

  private async handleArrowCreated(msg: {
    arrowId: string;
    sourceRef: string | null;
    targetRef: string | null;
  }) {
    if (this.document.uri.scheme !== "file" || this.isViewOnly()) {
      vscode.window.showInformationMessage(
        "Save the diagram to a workspace file to auto-link connections"
      );
      return;
    }
    try {
      const label =
        msg.sourceRef && msg.targetRef
          ? `${msg.sourceRef} → ${msg.targetRef}`
          : "Transition";
      const { link } = await allocateArrowRef(
        this.document.uri,
        label,
        this.extractName(this.document.uri)
      );
      this.postMessage({
        type: "apply-element-link",
        elementId: msg.arrowId,
        link,
      });
    } catch (e) {
      vscode.window.showErrorMessage(
        `Failed to link connection: ${(e as Error).message}`
      );
    }
  }

  isViewOnly() {
    return (
      this.document.uri.scheme === "git" ||
      this.document.uri.scheme === "conflictResolution"
    );
  }

  public postMessage(message: BridgeMessage) {
    this.webview.postMessage(message);
  }

  public async setupWebview() {
    // Setup initial content for the webview
    // Receive message from the webview.
    this.webview.options = {
      enableScripts: true,
    };

    let libraryUri = await this.getLibraryUri();

    const onDidReceiveMessage = this.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "library-change":
            const library = msg.library;
            await this.saveLibrary(library, libraryUri);
            ExcalidrawEditor._onDidChangeLibrary.fire(library);
            break;
          case "change":
            await this.document.update(new Uint8Array(msg.content));
            break;
          case "link-open":
            await openLink(vscode.Uri.parse(msg.url), this.document.uri);
            break;
          case "error":
            vscode.window.showErrorMessage(msg.content);
            break;
          case "info":
            vscode.window.showInformationMessage(msg.content);
            break;
          case "arrow-created":
            await this.handleArrowCreated(msg);
            break;
          case "viewport":
            if (this.document.uri.scheme === "file" && !this.isViewOnly()) {
              this.scheduleViewportWrite(msg);
            }
            break;
        }
      },
      this
    );

    const onDidChangeThemeConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.theme", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "theme-change",
          theme: this.getTheme(),
        });
      }, this);

    const onDidChangeVisualThemeConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          !e.affectsConfiguration("excalidraw.visualTheme", this.document.uri)
        ) {
          return;
        }
        this.webview.postMessage({
          type: "visual-theme-change",
          visualTheme: this.getVisualTheme(),
        });
      }, this);

    const onDidChangeCustomFeaturesConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          !e.affectsConfiguration(
            "excalidraw.enableCustomFeatures",
            this.document.uri
          )
        ) {
          return;
        }
        this.webview.postMessage({
          type: "custom-features-change",
          enabled: this.getEnableCustomFeatures(),
        });
      }, this);

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("excalidraw.language", this.document.uri)) {
        return;
      }
      this.webview.postMessage({
        type: "language-change",
        langCode: this.getLanguage(),
      });
    }, this);

    const onDidChangeEmbedConfiguration =
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("excalidraw.image", this.document.uri)) {
          return;
        }
        this.webview.postMessage({
          type: "image-params-change",
          imageParams: this.getImageParams(),
        });
      }, this);

    const onDidChangeLibraryConfiguration =
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (
          !e.affectsConfiguration(
            "excalidraw.workspaceLibraryPath",
            this.document.uri
          )
        ) {
          return;
        }

        libraryUri = await this.getLibraryUri();
        const library = await this.loadLibrary(libraryUri);
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      });

    const onLibraryImport = ExcalidrawEditor.onLibraryImport(
      async ({ library }) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: true,
        });
      }
    );

    const onDidChangeLibrary = ExcalidrawEditor.onDidChangeLibrary(
      (library) => {
        this.webview.postMessage({
          type: "library-change",
          library,
          merge: false,
        });
      }
    );

    // Live-reload the scene when the file changes on disk (e.g. edited by the
    // AutoVizerz diagram MCP or a git operation) while the editor is open.
    let watcher: vscode.FileSystemWatcher | undefined;
    if (
      this.document.uri.scheme === "file" &&
      this.document.contentType === "application/json" &&
      !this.isViewOnly()
    ) {
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.joinPath(this.document.uri, ".."),
          path.basename(this.document.uri.fsPath)
        )
      );
      watcher.onDidChange(async () => {
        const content = await vscode.workspace.fs.readFile(this.document.uri);
        if (contentEquals(content, this.document.content)) {
          // Our own save, or nothing actually changed.
          return;
        }
        this.document.content = content;
        this.postMessage({
          type: "document-change",
          content: Array.from(content),
        });
      });
    }

    this.webview.html = await this.buildHtmlForWebview({
      content: Array.from(this.document.content),
      contentType: this.document.contentType,
      library: await this.loadLibrary(libraryUri),
      viewModeEnabled: this.isViewOnly() || undefined,
      theme: this.getTheme(),
      visualTheme: this.getVisualTheme(),
      customFeaturesEnabled: this.getEnableCustomFeatures(),
      viewport:
        this.document.uri.scheme === "file"
          ? await this.readViewportSidecar()
          : undefined,
      imageParams: this.getImageParams(),
      langCode: this.getLanguage(),
      name: this.extractName(this.document.uri),
    });

    return new vscode.Disposable(() => {
      onDidReceiveMessage.dispose();
      onDidChangeThemeConfiguration.dispose();
      onDidChangeVisualThemeConfiguration.dispose();
      onDidChangeCustomFeaturesConfiguration.dispose();
      onLibraryImport.dispose();
      onDidChangeLibraryConfiguration.dispose();
      onDidChangeLibrary.dispose();
      onDidChangeEmbedConfiguration.dispose();
      watcher?.dispose();
      // Closing the editor must leave an up-to-date sidecar for restore.
      if (this.viewportWriteTimer) {
        clearTimeout(this.viewportWriteTimer);
        this.viewportWriteTimer = undefined;
      }
      this.flushViewportWrite();
    });
  }

  private getImageParams() {
    return vscode.workspace.getConfiguration("excalidraw").get("image");
  }

  private getLanguage() {
    return (
      vscode.workspace.getConfiguration("excalidraw").get("language") ||
      languageMap[vscode.env.language as keyof typeof languageMap]
    );
  }

  private getTheme() {
    return vscode.workspace
      .getConfiguration("excalidraw")
      .get("theme", "light");
  }

  private getVisualTheme() {
    return vscode.workspace
      .getConfiguration("excalidraw")
      .get("visualTheme", "classic");
  }

  private getEnableCustomFeatures() {
    return vscode.workspace
      .getConfiguration("excalidraw")
      .get("enableCustomFeatures", true);
  }

  public extractName(uri: vscode.Uri) {
    const name = path.parse(uri.fsPath).name;
    return name.endsWith(".excalidraw") ? name.slice(0, -11) : name;
  }

  public async getLibraryUri() {
    const libraryPath = await vscode.workspace
      .getConfiguration("excalidraw")
      .get<string>("workspaceLibraryPath");
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!libraryPath || !workspaceFolders) {
      return;
    }

    const fileWorkspace = getFileWorkspaceFolder(
      this.document.uri,
      workspaceFolders as vscode.WorkspaceFolder[]
    );
    if (!fileWorkspace) {
      return;
    }

    return vscode.Uri.joinPath(fileWorkspace.uri, libraryPath);
  }

  public static importLibrary(library: string) {
    this._onLibraryImport.fire({ library });
  }

  public async loadLibrary(libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.get<string>("library");
    }
    try {
      const libraryContent = await vscode.workspace.fs.readFile(libraryUri);
      return this.textDecoder.decode(libraryContent);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to load library: ${e}`);
      return this.context.globalState.get<string>("library");
    }
  }

  public async saveLibrary(library: string, libraryUri?: vscode.Uri) {
    if (!libraryUri) {
      return this.context.globalState.update("library", library);
    }
    try {
      await vscode.workspace.fs.writeFile(
        libraryUri,
        new TextEncoder().encode(library)
      );
    } catch (e) {
      await vscode.window.showErrorMessage(`Failed to save library: ${e}`);
    }
  }

  private async buildHtmlForWebview(config: any): Promise<string> {
    const webviewUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
      "dist"
    );
    const content = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(webviewUri, "index.html")
    );
    let html = this.textDecoder.decode(content);

    html = html.replace(
      "{{data-excalidraw-config}}",
      Base64.encode(JSON.stringify(config))
    );

    html = html.replace(
      "{{excalidraw-asset-path}}",
      `${this.webview.asWebviewUri(webviewUri).toString()}/`
    );

    return this.fixLinks(html, webviewUri);
  }
  private fixLinks(document: string, documentUri: vscode.Uri): string {
    return document.replace(
      new RegExp("((?:src|href)=['\"])(.*?)(['\"])", "gmi"),
      (subString: string, p1: string, p2: string, p3: string): string => {
        const lower = p2.toLowerCase();
        if (
          p2.startsWith("#") ||
          lower.startsWith("http://") ||
          lower.startsWith("https://")
        ) {
          return subString;
        }
        const newUri = vscode.Uri.joinPath(documentUri, p2);
        const newUrl = [p1, this.webview.asWebviewUri(newUri), p3].join("");
        return newUrl;
      }
    );
  }
}

function contentEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function getFileWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolders: vscode.WorkspaceFolder[]
): vscode.WorkspaceFolder | undefined {
  const parts = uri.path.split(path.sep).slice(0, -1);
  while (parts.length > 0) {
    const joined = parts.join(path.sep);
    const folder = workspaceFolders.find((f) => f.uri.path === joined);
    if (folder) {
      return folder;
    }
    parts.pop();
  }
}

async function openLink(uri: vscode.Uri, source: vscode.Uri): Promise<void> {
  if (uri.scheme !== "file") {
    await vscode.env.openExternal(uri);
    return;
  }

  const targetUri = vscode.Uri.joinPath(source, "..", uri.path);
  try {
    // Ensure the resource exists and is a file
    const stat = await vscode.workspace.fs.stat(targetUri);
    if (stat.type !== vscode.FileType.File) {
      throw new Error(`${targetUri.fsPath} is not a file`);
    }
  } catch (e) {
    // Otherwise, open it externally
    await vscode.env.openExternal(uri);
    return;
  }

  const extensions = [
    ".excalidraw",
    ".excalidraw.json",
    ".excalidraw.png",
    ".excalidraw.svg",
  ];
  for (const ext of extensions) {
    if (targetUri.fsPath.endsWith(ext)) {
      await showEditor(targetUri);
      return;
    }
  }

  const openBeside =
    vscode.workspace
      .getConfiguration("excalidraw")
      .get<string>("linkOpenLocation", "beside") === "beside";
  await vscode.window.showTextDocument(targetUri, {
    preview: true,
    viewColumn: openBeside ? vscode.ViewColumn.Beside : undefined,
  });
}
