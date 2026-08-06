import * as vscode from "vscode";
import type { ExcalidrawEditor } from "./editor";

interface FocusElementMessage {
  type: "focus-element";
  ref: string;
}

interface DocumentChangeMessage {
  type: "document-change";
  content: number[];
}

export type BridgeMessage = FocusElementMessage | DocumentChangeMessage;

/**
 * Bridge between VS Code (commands, URI handler, external automation) and the
 * Excalidraw webviews. Owns the registry of live editors and the message
 * protocol used to drive them, so custom logic stays out of the React app.
 */
export class ExcalidrawBridge {
  private static editors = new Set<ExcalidrawEditor>();
  private static activeEditor: ExcalidrawEditor | undefined;

  public static register(
    editor: ExcalidrawEditor,
    panel: vscode.WebviewPanel
  ): vscode.Disposable {
    this.editors.add(editor);
    if (panel.active) {
      this.activeEditor = editor;
    }

    const onDidChangeViewState = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.activeEditor = editor;
      }
    });

    return new vscode.Disposable(() => {
      onDidChangeViewState.dispose();
      this.editors.delete(editor);
      if (this.activeEditor === editor) {
        this.activeEditor = undefined;
      }
    });
  }

  public static findEditor(uri: vscode.Uri): ExcalidrawEditor | undefined {
    for (const editor of this.editors) {
      if (editor.document.uri.toString() === uri.toString()) {
        return editor;
      }
    }
    return undefined;
  }

  private static async waitForEditor(
    uri: vscode.Uri,
    timeoutMs = 5000
  ): Promise<ExcalidrawEditor | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const editor = this.findEditor(uri);
      if (editor) {
        return editor;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  }

  /**
   * Focus an element in an Excalidraw editor. When `uri` is given, the file is
   * opened in the Excalidraw editor first if needed; otherwise the currently
   * active editor is used.
   */
  public static async focusElement(
    ref: string,
    uri?: vscode.Uri
  ): Promise<boolean> {
    let editor = uri ? this.findEditor(uri) : this.activeEditor;
    if (!editor && uri) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        "editor.excalidraw"
      );
      editor = await this.waitForEditor(uri);
    }
    if (!editor) {
      return false;
    }
    editor.postMessage({ type: "focus-element", ref });
    return true;
  }
}
