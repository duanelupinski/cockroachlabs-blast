# CockroachDB Blast

VS Code and Cursor extension for **local insecure** CockroachDB demos. The playbook shows **US and EU super regions** with three tables: a GLOBAL price list, REGIONAL BY TABLE orders confined to EU, and REGIONAL BY ROW customers domiciled by continent.

## What you get

- 6-node **multi-region** cluster in **Docker or Podman**: 3× `us-east` (Virginia) and 3× `eu-west` (Ireland), always `--insecure`
- **HA** demo: 3-node `us-east` cluster (one per AZ), with an option in the presenter to add a second node in each AZ
- Presenter: 3D globe with table-scoped **replica counts**, super-region playbook, **HA kill/start**, **DB Console** tab
- Real `cockroach sql --insecure` in an editor-area terminal below the presenter (history, `\dt`, tab completion)

## Prerequisites

Install these **before** you start the cluster. The container engine must already be running.

| Dependency | Why | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) 20+ | Build the extension and webview | `node -v` |
| [VS Code](https://code.visualstudio.com/) 1.85+ **or** [Cursor](https://cursor.com/) | Host the extension | Either works; same `.vsix` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) **or** [Podman](https://podman.io/) / [Podman Desktop](https://podman-desktop.io/) | Run the 6-node cluster | **Start the app first** so `docker` or `podman` responds |

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

A 6-node demo needs several GB of RAM. Give Docker/Podman at least **6 GB**.

Optional: a CockroachDB **enterprise license** in editor settings if `ADD SUPER REGION` fails on self-hosted.

## Install (Cursor or VS Code)

From a clone of this repo:

```bash
cd cockroachlabs-blast
./build.sh
```

That produces `dist/cockroachlabs-blast-0.2.1.vsix`.

**Cursor**

`cursor` on your PATH is often the **agent CLI**, which does not install extensions (`No Cursor IDE installation found`). Use the IDE binary, or install from the UI.

```bash
# macOS — Cursor.app CLI (not ~/.local/bin/cursor)
/Applications/Cursor.app/Contents/Resources/app/bin/cursor --install-extension dist/cockroachlabs-blast-0.2.1.vsix --force
```

Then **Developer: Reload Window**. Optional: Command Palette → **Shell Command: Install 'cursor' command in PATH** so a new terminal uses the IDE `cursor`.

**VS Code**

```bash
code --install-extension dist/cockroachlabs-blast-0.2.1.vsix --force
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
3. If you already had a **9-node / 3-region** or **6-region** cluster, **Destroy cluster** first. The two-region topology cannot reuse those containers.
4. Click **Start 6-node cluster**. Wait until the notification says the cluster started (first pull of `cockroachdb/cockroach` can take a few minutes).
5. Click **Open Presenter**. That opens the globe/playbook webview on top and a real `cockroach sql --insecure` terminal below it.
6. Walk the playbook. **Run step** loads SQL via `\i` into that terminal.
7. Use the **DB Console** tab for `http://localhost:8080`.

**Table locality:** open **Multi-region - table locality** and start the 9-node cluster (US-East, US-West, EU-West). Each region gets a replica-count box for `orders`, `customers`, and `prices`. The US-West box sits up and to the left of Oregon so it stays clear of the US-East and EU-West boxes. The previous two-region demo is still **Multi-region** — start that 6-node cluster to revert.

**High availability:** in the sidebar, open **High availability and resiliency** and start the 3-node cluster. The presenter lists Kill/Start per node, **Add a node in each AZ** (6 nodes in US-East), **Expand to multi-region** (9 nodes: US-East, US-West, EU-West), and **Scale down to 3 nodes** to remove extras.

**Zero downtime upgrade:** open **Zero downtime upgrade** and start the 3-node cluster. It comes up on CockroachDB v25.4 in `us-west` (one node per zone). The presenter playbook pauses auto-finalization, then rolls each node to v26.2. The globe marker for that node turns red while it is down; HAProxy keeps SQL on the other two. Finalize once all three binaries are on v26.2. A major-version finalize needs `cockroachBlast.enterpriseLicense` in settings.

Playbook story (previous two-region **Multi-region** demo):

1. Two regions + super regions **US** = `{us-east}` and **EU** = `{eu-west}`
2. `prices`, `orders`, and `customers` start **GLOBAL** (12 ranges each, replicas in both regions)
3. **Before** — replica regions for all three tables (US and EU)
4. **REGIONAL BY TABLE** on `orders` in `eu-west` — before: both regions; after: EU only
5. **REGIONAL BY ROW** on `customers` — before: still both regions; after: CA/TX/NY in US, IE/SE/DE in EU
6. `prices` stays GLOBAL on both continents

SQL output is replica locations only (`range_id` + regions, plus a per-region count). No leaseholders or voter/non-voter columns.

Command Palette equivalents:

- `CockroachDB Blast: Start 6-Node Cluster`
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
