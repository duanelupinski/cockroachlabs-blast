import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';

function fileCacheBuster(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
  } catch {
    return Date.now().toString(36);
  }
}

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: string
): string {
  const distUri = vscode.Uri.joinPath(extensionUri, 'webapp', 'dist');
  const jsPath = vscode.Uri.joinPath(distUri, 'assets', 'index.js');
  const cssPath = vscode.Uri.joinPath(distUri, 'assets', 'index.css');
  const cacheBuster = fileCacheBuster(jsPath.fsPath);
  const scriptUri = webview.asWebviewUri(jsPath) + `?v=${cacheBuster}`;
  const styleUri = webview.asWebviewUri(cssPath) + `?v=${cacheBuster}`;
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:* http://127.0.0.1:*; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>CockroachDB BLAST (Brief Live Assessment & Showcase Tool)</title>
</head>
<body>
  <div id="root" data-view="${view}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
