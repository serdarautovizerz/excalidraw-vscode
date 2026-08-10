import * as vscode from "vscode";

export function getActiveWorkspace() {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const doc = activeEditor.document;
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    return ws;
  }

  const wsf = vscode.workspace.workspaceFolders;
  if (wsf && wsf.length > 0) {
    const ws = wsf[0];
    return ws;
  }
  return undefined;
}

let runningCounter = 0;

export async function newUntitledExcalidrawDocument() {
  runningCounter += 1;
  const ws = getActiveWorkspace();
  const fileName = `Untitled-${runningCounter}.excalidraw`;
  // Built through Uri.joinPath rather than string concatenation: the bundle's
  // `path` is POSIX-only, so joining onto a backslashed fsPath produced a
  // mixed-separator path.
  const uri = ws
    ? vscode.Uri.joinPath(ws.uri, fileName).with({ scheme: "untitled" })
    : vscode.Uri.parse(`untitled:${fileName}`);
  await vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    "editor.excalidraw"
  );
}
