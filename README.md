# CockroachDB Blast

VS Code / Cursor extension for local insecure CockroachDB demos. First playbook: **GDPR super regions** (keep EU customer data in `eu-west` + `eu-central`).

## What you get

- 9-node cluster in **Docker or Podman**: 3× `us-east`, 3× `eu-west`, 3× `eu-central`, always `--insecure`
- Presenter: 3D globe with table-scoped replica counts, GDPR playbook, **DB Console** tab
- Real `cockroach sql --insecure` in an editor-area terminal (history, `\dt`, tab completion)

## Prerequisites

- Node.js 20+
- Docker Desktop or Podman
- VS Code 1.85+ or Cursor

## Build and run

```bash
./build.sh
# VS Code
code --install-extension dist/cockroachlabs-blast-0.1.0.vsix
# Cursor
cursor --install-extension dist/cockroachlabs-blast-0.1.0.vsix
```

Or press **F5** in this folder (Extension Development Host).

From the **CRDB Blast** sidebar: **Start 9-node cluster**, then **Open Presenter**. Walk the playbook; **Run step** types SQL into the live CLI.

SQL is on `localhost:26257`. DB Console is on `http://localhost:8080`.

Super regions need an enterprise license on self-hosted. Set `cockroachBlast.enterpriseLicense` and `cockroachBlast.cluster.organization` in settings if `ADD SUPER REGION` fails.

## Project rule

All clusters in this repo stay local (Docker/Podman) and insecure. See `.cursor/rules/local-insecure-clusters.mdc`.
