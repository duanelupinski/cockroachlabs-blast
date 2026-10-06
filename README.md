# CockroachDB BLAST

CockroachDB BLAST (Brief Live Assessment & Showcase Tool) is a Cursor and VS Code extension for live CockroachDB demonstrations. Each exercise is a local cluster you start from the sidebar, plus a presenter that walks the story: a globe, a playbook, DB Console, and a real `cockroach sql` terminal.

Everything runs in Docker or Podman on your client. Nodes stay on your machine, always `--insecure`. SQL is on `localhost:26257` and DB Console is on `localhost:8080`.

## Installation

Install these before you build or start a cluster. The container engine must already be running.

| Dependency | Why |
| --- | --- |
| [Node.js](https://nodejs.org/) 20+ | Build the extension and the presenter |
| [Cursor](https://cursor.com/) or [VS Code](https://code.visualstudio.com/) 1.85+ | Host the extension |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/) | Run the clusters |

Confirm the engine responds:

```bash
docker info
# or
podman info
```

Free host ports `26257` (SQL) and `8080` (DB Console). Give Docker or Podman at least **8 GB** of memory so the 9-node exercise has room. Settings → **CockroachDB Blast: Container Engine** can be `auto` (Docker, then Podman), `docker`, or `podman`.

From a clone of this repo:

```bash
cd cockroachlabs-blast
./build.sh
```

That writes `dist/cockroachlabs-blast-0.2.1.vsix`.

**Cursor** — `cursor` on your PATH is often the agent CLI and will not install extensions. Use the IDE binary:

```bash
/Applications/Cursor.app/Contents/Resources/app/bin/cursor --install-extension dist/cockroachlabs-blast-0.2.1.vsix --force
```

**VS Code:**

```bash
code --install-extension dist/cockroachlabs-blast-0.2.1.vsix --force
```

Then run **Developer: Reload Window**. You can also install from the Extensions view: `…` → **Install from VSIX…**.

To work from source instead, open this folder, run `./build.sh`, and press **F5**. Use **CRDB Blast** in the Extension Development Host window.

Only one BLAST cluster runs at a time. If another exercise is up, choose **Destroy cluster** in the sidebar before starting the next one. The same ports and container names are reused.


## Demos

Open the **CRDB Blast** icon in the Activity Bar. Under the exercise you want, start the cluster, wait for the notification, then **Open Presenter**. The presenter opens above a `cockroach sql --insecure` terminal. **Run step** sends that step’s SQL into the terminal. The **DB Console** tab is `http://localhost:8080`.

### Multi-region — table locality

A 9-node cluster: three nodes in US-East (Virginia), three in US-West (Oregon), and three in EU-West (Ireland). The globe shows a replica-count box on each region for `prices`, `orders`, and `customers`. Super region **US** is `{us-east, us-west}`. Super region **EU** is `{eu-west}`.

Suggested steps:

1. Start the **9-node cluster** and open the presenter.
2. Run **Create a three-region database**. That registers the three regions and the two super regions.
3. Run **Create prices, orders, and customers as GLOBAL**. Each table’s replicas show up in all three regions.
4. Run **Before — all three tables** and look at the three replica boxes together.
5. Run **Regional by table — confine orders to the US super region**. `orders` keeps three replicas in US-East and three in US-West. The EU-West box goes to zero for that table. `customers` and `prices` stay global.
6. Run **Regional by row** for `customers`. The customers row stays a single line and shows how many replicas sit in each region, the same way the other tables do.
7. Run **Show prices**. `prices` is still global, with replicas in all three regions.

### High availability and resiliency

A 3-node US-East cluster, one node in each availability zone. The presenter lists every node with Kill and Start, and can add capacity without leaving the demo.

Suggested steps:

1. Start the **3-node cluster** and open the presenter. You should see one live node in each US-East zone.
2. **Kill** one node. The cluster stays up on the other two. **Start** that node again and wait until it is live.
3. Choose **Add a node in each AZ**. The cluster grows to six nodes, two per zone. Kill any one node and the others keep serving.
4. Choose **Expand to multi-region (9 nodes)** to add US-West and EU-West. Kill a node in any region and confirm the cluster stays up.
5. Choose **Scale down to 3 nodes** to return to the original US-East trio.

### Zero downtime upgrade

A 3-node US-West cluster that starts on CockroachDB v25.4 and rolls, one node at a time, to v26.2. SQL stays on HAProxy, so the client keeps working while a node is down. The globe marker for that node turns red until it rejoins.

Suggested steps:

1. Start the **3-node cluster** and open the presenter. Do not change the version picker; this exercise pins v25.4 and v26.2 itself.
2. Run **Confirm the us-west cluster is healthy**. Under-replicated ranges should be 0.
3. Run **Pause auto-finalization** so the cluster does not finalize the moment the last node is on v26.2.
4. Run the three **Upgrade us-west-N** steps in order. Each node drains, restarts on v26.2, and comes back while the other two serve SQL.
5. Run **Binaries are v26.2; cluster version is still 25.4**. This is the rollback window.
6. Run **Finalize the upgrade to v26.2**. This needs the enterprise license in settings. After it finishes, the cluster cannot roll back to v25.4.

### MCP server

A 3-node cluster with the MovR ride-sharing workload and the CockroachDB MCP server. The presenter chart plots workload throughput while you drop an index, ask the agent what is missing, and put the index back.

Suggested steps:

1. Start the **3-node cluster** and open the presenter.
2. Run **Load the MovR demo database**.
3. Run **Run the MovR workload** and wait until the chart settles on a steady line. Leave the workload running for the rest of the exercise.
4. Run **Drop the vehicle index on rides**. Throughput should fall.
5. Run **Ask the MCP server which index is missing**. The agent should name the dropped rides index.
6. Run **Put the rides vehicle index back**. Throughput should climb while MovR is still running.
