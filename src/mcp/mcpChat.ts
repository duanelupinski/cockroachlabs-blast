import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ContainerEngine } from '../cluster/engine';

const SECRET_KEY = 'cockroachBlast.cursorApiKey';
const INSTRUCTIONS = [
  'You are demonstrating the CockroachDB MCP server against a local insecure MovR database named movr.',
  'Use only the CockroachDB MCP tools. Do not edit files and do not run shell commands.',
  'When asked about a slow workload or a missing index, call the index recommendation tool and name the index.',
].join(' ');

interface StdioServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

type SdkModule = {
  Agent: {
    create(options: Record<string, unknown>): Promise<SdkAgent>;
  };
  JsonlLocalAgentStore: new (dir: string) => unknown;
  CursorAgentError: new (message?: string) => Error & { message: string };
};

interface SdkAgent {
  send(message: string): Promise<SdkRun>;
  close(): void;
  [Symbol.asyncDispose](): Promise<void>;
}

interface SdkRun {
  stream(): AsyncIterable<SdkEvent>;
  wait(): Promise<{ status: string; result?: string; error?: { message?: string } }>;
  cancel(): Promise<void>;
}

interface SdkEvent {
  type: string;
  text?: string;
  name?: string;
  status?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
}

export class McpChatSession {
  private agent: SdkAgent | null = null;
  private run: SdkRun | null = null;
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: ContainerEngine,
    private readonly post: (message: Record<string, unknown>) => void
  ) {}

  async pushKeyStatus(): Promise<void> {
    const key = await this.resolveKey();
    this.post({ type: 'mcpKey', saved: Boolean(key) });
  }

  async saveKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      await this.context.secrets.delete(SECRET_KEY);
    } else {
      await this.context.secrets.store(SECRET_KEY, trimmed);
    }
    await this.disposeAgent();
    await this.pushKeyStatus();
  }

  async clearKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_KEY);
    await this.disposeAgent();
    await this.pushKeyStatus();
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;
    if (this.busy) {
      this.post({ type: 'mcpStatus', phase: 'error', error: 'The agent is still answering.' });
      return;
    }
    const apiKey = await this.resolveKey();
    if (!apiKey) {
      this.post({ type: 'mcpKey', saved: false });
      this.post({ type: 'mcpStatus', phase: 'error', error: 'Add a Cursor API key to start the chat.' });
      this.post({ type: 'mcpTurnDone' });
      return;
    }
    this.busy = true;
    this.post({ type: 'mcpStatus', phase: 'running' });
    try {
      const agent = await this.ensureAgent(apiKey);
      const run = await agent.send(`${INSTRUCTIONS}\n\n${prompt}`);
      this.run = run;
      let assistant = '';
      for await (const event of run.stream()) {
        if (event.type === 'assistant') {
          for (const block of event.message?.content ?? []) {
            if (block.type === 'text' && block.text) {
              assistant = block.text.startsWith(assistant) ? block.text : assistant + block.text;
              this.post({ type: 'mcpDelta', text: assistant });
            }
          }
        } else if (event.type === 'tool_call' && event.name) {
          this.post({ type: 'mcpTool', name: event.name, status: event.status ?? '' });
        }
      }
      const result = await run.wait();
      if (result.status === 'error') {
        this.post({
          type: 'mcpStatus',
          phase: 'error',
          error: result.error?.message || 'The Cursor agent run failed.',
        });
      } else if (!assistant && result.result) {
        this.post({ type: 'mcpDelta', text: result.result });
      }
      this.post({ type: 'mcpTurnDone' });
      this.post({ type: 'mcpStatus', phase: 'idle' });
    } catch (err: unknown) {
      this.post({ type: 'mcpStatus', phase: 'error', error: errorMessage(err) });
      this.post({ type: 'mcpTurnDone' });
    } finally {
      this.run = null;
      this.busy = false;
    }
  }

  async dispose(): Promise<void> {
    await this.disposeAgent();
  }

  private async resolveKey(): Promise<string | undefined> {
    const stored = (await this.context.secrets.get(SECRET_KEY))?.trim();
    if (stored) return stored;
    const env = process.env.CURSOR_API_KEY?.trim();
    return env || undefined;
  }

  private async ensureAgent(apiKey: string): Promise<SdkAgent> {
    if (this.agent) return this.agent;
    const sdk = (await import('@cursor/sdk')) as SdkModule;
    const scratch = path.join(this.context.globalStorageUri.fsPath, 'mcp-agent');
    const storeDir = path.join(scratch, 'store');
    fs.mkdirSync(storeDir, { recursive: true });
    const store = new sdk.JsonlLocalAgentStore(storeDir);
    this.agent = await sdk.Agent.create({
      apiKey,
      model: { id: 'auto' },
      tools: ['mcp'],
      local: {
        cwd: scratch,
        settingSources: [],
        store,
      },
      mcpServers: loadMcpServers(this.context.extensionPath, this.engine.id),
    });
    return this.agent;
  }

  private async disposeAgent(): Promise<void> {
    try {
      await this.run?.cancel();
    } catch {
      /* run may already be finished */
    }
    this.run = null;
    const agent = this.agent;
    this.agent = null;
    if (!agent) return;
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      agent.close();
    }
  }
}

function loadMcpServers(extensionPath: string, engineCommand: string): Record<string, StdioServer> {
  const file = path.join(extensionPath, 'demos', 'mcp.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers?: Record<string, StdioServer> };
  const servers = raw.mcpServers ?? {};
  for (const server of Object.values(servers)) {
    if (server.command === 'docker' || server.command === 'podman') {
      server.command = engineCommand;
    }
  }
  return servers;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
