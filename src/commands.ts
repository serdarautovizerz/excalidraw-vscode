import * as vscode from "vscode";
import * as path from "path";
import { newUntitledExcalidrawDocument } from "./utils";
import { ExcalidrawBridge } from "./bridge";

function getConfigurationScope(
  config: vscode.WorkspaceConfiguration,
  key: string
) {
  const inspect = config.inspect(key);
  if (inspect?.workspaceFolderValue) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  if (inspect?.workspaceValue) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

async function updateTheme() {
  const excalidrawConfig = vscode.workspace.getConfiguration("excalidraw");
  const initialTheme = excalidrawConfig.get<string>("theme");
  // Todo: find out the scope of the current theme config before updating it
  const configurationScope = getConfigurationScope(excalidrawConfig, "theme");
  const updateThemeConfig = (variant: string | undefined) => {
    excalidrawConfig.update("theme", variant, configurationScope);
  };

  const quickPick = vscode.window.createQuickPick();
  const items = [
    {
      label: "light",
      description: "Always use light theme",
    },
    {
      label: "dark",
      description: "Always use dark theme",
    },
    {
      label: "auto",
      description: "Sync theme with VSCode",
    },
  ];
  quickPick.items = items;
  quickPick.activeItems = items.filter((item) => item.label === initialTheme);

  quickPick.onDidChangeActive((actives) => {
    if (actives.length > 0) {
      updateThemeConfig(actives[0].label);
    }
  });

  let confirm = false;
  quickPick.onDidAccept(() => {
    confirm = true;
    const actives = quickPick.activeItems;
    if (actives.length > 0) {
      updateThemeConfig(actives[0].label);
    } else {
      updateThemeConfig(initialTheme);
    }
    quickPick.hide();
  });
  quickPick.onDidHide(() => {
    if (!confirm) {
      updateThemeConfig(initialTheme);
    }
  });

  quickPick.show();
}

function showSource(uri: vscode.Uri, viewColumn?: vscode.ViewColumn) {
  vscode.window.showTextDocument(uri, { viewColumn });
}

export async function showEditor(
  uri: vscode.Uri,
  viewColumn?: vscode.ViewColumn
) {
  await vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    "editor.excalidraw",
    viewColumn
  );
}

function showImage(uri: vscode.Uri, viewColumn?: vscode.ViewColumn) {
  vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    "imagePreview.previewEditor",
    viewColumn
  );
}

async function newFile() {
  try {
    await newUntitledExcalidrawDocument();
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to create new file: ${error}`);
  }
}

function resolveFileArg(file: string): vscode.Uri {
  if (path.isAbsolute(file)) {
    return vscode.Uri.file(file);
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return vscode.Uri.file(file);
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, file);
}

async function focusElement(args?: string | { ref?: string; file?: string }) {
  let ref: string | undefined;
  let file: string | undefined;
  if (typeof args === "string") {
    ref = args;
  } else if (args) {
    ref = args.ref;
    file = args.file;
  }

  if (!ref) {
    ref = await vscode.window.showInputBox({
      prompt: "Element reference (e.g. D10, N15) or element ID",
      placeHolder: "D10",
    });
  }
  if (!ref) {
    return;
  }

  const uri = file ? resolveFileArg(file) : undefined;
  const focused = await ExcalidrawBridge.focusElement(ref, uri);
  if (!focused) {
    vscode.window.showErrorMessage(
      uri
        ? `Failed to open an Excalidraw editor for ${uri.fsPath}`
        : "No active Excalidraw editor to focus an element in"
    );
  }
}

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.newFile", newFile)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.newSceneFile", newFile)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.updateTheme", updateTheme)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showSource", showSource)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showEditor", showEditor)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showImage", showImage)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showImageToSide", (uri) =>
      showImage(uri, vscode.ViewColumn.Beside)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showEditorToSide", (uri) =>
      showEditor(uri, vscode.ViewColumn.Beside)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.showSourceToSide", (uri) =>
      showSource(uri, vscode.ViewColumn.Beside)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.preventDefault", () => {})
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw.focusElement", focusElement)
  );
}
