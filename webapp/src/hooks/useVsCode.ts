const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

export function postMessage(message: unknown) {
  vscode?.postMessage(message);
}

export function onMessage(handler: (message: MessageEvent) => void) {
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
