import * as vscode from "vscode";
import { ExcalidrawEditor } from "./editor";

export class ExcalidrawUriHandler implements vscode.UriHandler {
  public static register() {
    const provider = new ExcalidrawUriHandler();
    const providerRegistration = vscode.window.registerUriHandler(provider);
    return providerRegistration;
  }

  public async handleUri(uri: vscode.Uri) {
    // vscode://autovizerz.excalidraw-editor/focus?element=D10&file=diagram.excalidraw
    if (uri.path === "/focus") {
      const query = new URLSearchParams(uri.query);
      const ref = query.get("element");
      const file = query.get("file");
      if (!ref) {
        vscode.window.showErrorMessage(
          "Missing 'element' query parameter in focus URL"
        );
        return;
      }
      await vscode.commands.executeCommand("excalidraw.focusElement", {
        ref,
        file: file ?? undefined,
      });
      return;
    }

    const hash = new URLSearchParams(uri.fragment);
    const libraryUrl = hash.get("addLibrary");
    if (libraryUrl) {
      const res = await fetch(libraryUrl);
      const library = await res.text();
      ExcalidrawEditor.importLibrary(library);
    } else {
      vscode.window.showErrorMessage("Invalid URL!");
    }
  }
}
