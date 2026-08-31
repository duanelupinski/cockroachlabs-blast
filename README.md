# CockroachDB Blast

VS Code and Cursor extension for **local insecure** CockroachDB demos. The first playbook is **GDPR super regions**: show `app.customers` across us-east, eu-west, and eu-central, then bind the table to an EU super region.

## What you get

- 9-node cluster in **Docker or Podman**: 3× `us-east`, 3× `eu-west`, 3× `eu-central`, always `--insecure`
- Presenter: 3D globe with table-scoped replica counts, GDPR playbook, **DB Console** tab
- Real `cockroach sql --insecure` in an editor-area terminal (history, `\dt`, tab completion)

## Prerequisites

Install these **before** you start the cluster. The container engine must already be running.

| Dependency | Why | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) 20+ | Build the extension and webview | `node -v` |
| [VS Code](https://code.visualstudio.com/) 1.85+ **or** [Cursor](https://cursor.com/) | Host the extension | Either works; same `.vsix` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) **or** [Podman](https://podman.io/) / [Podman Desktop](https://podman-desktop.io/) | Run the 9-node cluster | **Start the app first** so `docker` or `podman` responds |

Confirm the engine is up:

```bash
docker info
# or
podman info
```

If that fails, open Docker Desktop or Podman Desktop and wait until it is ready. Do not start CockroachDB on the host; the extension only talks to local containers.

Free these host ports (defaults):

- `26257` — SQL
- `8080` — DB Console

A 9-node demo needs several GB of RAM. Give Docker/Podman at least **8 GB**.

Optional: a CockroachDB **enterprise license** in editor settings if `ADD SUPER REGION` fails on self-hosted.

## Install (Cursor or VS Code)

From a clone of this repo:

```bash
cd cockroachlabs-blast
./build.sh
```

That produces `dist/cockroachlabs-blast-0.1.0.vsix`.

**Cursor**

```bash
cursor --install-extension dist/cockroachlabs-blast-0.1.0.vsix
```

Then reload the window (`Developer: Reload Window`) if the sidebar does not appear.

**VS Code**

```bash
code --install-extension dist/cockroachlabs-blast-0.1.0.vsix
```

Reload the window the same way.

You can also install from the UI: Extensions → `…` → **Install from VSIX…** → pick the file.

## Run from source (development)

1. Open this folder in **Cursor** or **VS Code**.
2. Run `npm install` and `cd webapp && npm install && npm run build && cd ..` (or `./build.sh` without the vsce step).
3. Press **F5** (Run Extension). A new Extension Development Host window opens.
4. Use **CRDB Blast** in that host window, not in the window you pressed F5 from.

## Run a demo

1. Confirm Docker or Podman is running (`docker info` or `podman info`).
2. In Cursor or VS Code, open the **CRDB Blast** icon in the Activity Bar.
3. Click **Start 9-node cluster**. Wait until the notification says the cluster started (first pull of `cockroachdb/cockroach` can take a few minutes).
4. Click **Open Presenter**. That opens the globe/playbook webview and a real `cockroach sql --insecure` terminal beside it.
5. Walk the playbook. **Run step** types SQL into that terminal.
6. Use the **DB Console** tab for `http://localhost:8080`.

Command Palette equivalents:

- `CockroachDB Blast: Start 9-Node Cluster`
- `CockroachDB Blast: Open Presenter`
- `CockroachDB Blast: Open SQL Terminal`
- `CockroachDB Blast: Destroy Cluster`

Engine preference: Settings → **CockroachDB Blast: Container Engine** (`auto`, `docker`, or `podman`). `auto` prefers Docker, then Podman.

## Super regions license

If `ALTER DATABASE … ADD SUPER REGION` errors on license, set **user** settings (not a file in this repo):

- `cockroachBlast.enterpriseLicense`
- `cockroachBlast.cluster.organization`

Then start or restart the cluster so those settings apply.

## Tear down

From the sidebar: **Destroy cluster**.

Or:

```bash
docker compose -f deployments/docker-compose.yml -p blast-cluster down -v
# or
podman compose -f deployments/docker-compose.yml -p blast-cluster down -v
```

## Project rules

Clusters stay local (Docker/Podman), insecure, with SQL on `26257` and DB Console on `8080`. See `.cursor/rules/`.
