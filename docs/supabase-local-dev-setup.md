# Local Supabase Dev Stack: Setup Walkthrough

How to run the full Supabase stack (Postgres, Auth, REST API, Studio) on your own
machine with Docker. This is the standard dev setup for the Supabase migration
(decision 8 in [supabase-migration-plan.md](supabase-migration-plan.md)): schema
changes are developed and tested locally first, then pushed to the cloud project.

This guide was written while setting up the first dev machine (Windows 10, AMD CPU)
and covers every step from bare metal. Most steps are one-time.

## 1. Prerequisites

### 1a. CPU virtualization (one-time, BIOS)

Docker on Windows needs hardware virtualization. Check first: open Task Manager >
Performance > CPU and look for `Virtualization: Enabled`, or run in PowerShell:

```powershell
(Get-CimInstance Win32_Processor).VirtualizationFirmwareEnabled
```

If it reports `False`, reboot into BIOS/UEFI setup and enable:

- **AMD boards:** `SVM Mode` (usually under Advanced CPU settings or "OC" > CPU features)
- **Intel boards:** `Intel VT-x` (sometimes "Intel Virtualization Technology")

Save, boot back into Windows, and re-run the check. It should now report `True`.

### 1b. Docker Desktop

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the
WSL 2 backend (the default on Windows 10/11; it works on Home editions). If WSL 2
itself is missing, Docker Desktop's installer sets it up.

Verify Docker is alive:

```powershell
docker version --format '{{.Server.Version}}'
```

Any version number back means the engine is running. If it errors, start Docker
Desktop from the Start menu and wait for the whale icon to settle.

### 1c. Supabase CLI

On Windows, install via [scoop](https://scoop.sh/):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase/supabase
supabase --version
```

On macOS/Linux: `brew install supabase/tap/supabase`.

If a freshly installed command is not found in an already-open terminal, open a new
terminal (the PATH change only applies to new sessions).

### 1d. psql client (optional but useful)

For command-line checks against the local database. On Windows:

```powershell
scoop install postgresql
```

Note: scoop's postgresql package adds its `bin` directory to PATH instead of
creating shims, so `psql` only resolves in terminals opened after the install.
The binary lives at `~\scoop\apps\postgresql\current\bin\psql.exe`.

## 2. Start the stack

The repo already contains the CLI project scaffolding (`supabase/config.toml`,
created once with `supabase init`), so you do NOT run `supabase init` yourself.
From the repo root:

```powershell
supabase start
```

The first run downloads several GB of Docker images and takes a few minutes.
Later runs take seconds. When it finishes it prints the local endpoints and keys.

To see them again at any time: `supabase status`.

| Service | URL |
|---------|-----|
| API (REST/Auth/GraphQL) | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio dashboard | http://127.0.0.1:54323 |
| Mailpit (captures outgoing mail) | http://127.0.0.1:54324 |

The keys printed by `supabase status` (anon key, service role key, JWT secret) are
the same well-known defaults on every machine that runs Supabase locally. They are
not secrets and they do not touch the cloud project.

## 3. Verify it works

1. Open http://127.0.0.1:54323 in a browser. Studio should load and show a running
   database.
2. Query Postgres directly:

   ```powershell
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select version();"
   ```

3. `docker ps` should list ~11 healthy `supabase_*_WGA-Raid-Hub` containers.

A fresh local database has ZERO tables in the `public` schema. That is correct:
the local stack builds only from migration files in `supabase/migrations/`, and it
knows nothing about the cloud schema until the baseline migration is captured
(Phase 1 step 2 of the migration plan). If the migrations directory has files,
the tables appear after `supabase db reset`.

## 4. Link to the cloud project (one-time)

Linking tells the CLI which cloud project this repo belongs to, which later enables
`supabase db pull` / `db push`. Run these yourself in a terminal; both involve
credentials that should never pass through anything else:

```powershell
supabase login
supabase link --project-ref kxgjqnpwfklbgrxdgmmv
```

- `supabase login` opens a browser window; approve it and the CLI stores an access
  token for your Supabase account.
- `supabase link` prompts for the cloud database password. Get it from the project
  owner. It is not stored in the repo and must never be committed.

Link state is written to `supabase/.temp/`, which is gitignored. Verify with
`supabase projects list`: the linked project shows a `●` marker.

## 5. Day-to-day commands

| Command | What it does |
|---------|--------------|
| `supabase start` | Start the local stack |
| `supabase stop` | Stop it (data volumes are kept) |
| `supabase status` | Show endpoints and keys |
| `supabase db reset` | Rebuild the local database from `supabase/migrations/` + seed |

Docker Desktop must be running before `supabase start`.

## Known quirk: vector container restart loop (Windows)

On Docker Desktop for Windows the `supabase_vector` container (log shipping for the
local Logs page) can restart-loop forever. Everything else works fine. Local
analytics is therefore disabled in `supabase/config.toml` (`[analytics]
enabled = false`), which removes the vector and analytics containers from the
stack. The only loss is the Logs page inside local Studio.

## What comes next

With the stack running and linked, the next migration-plan steps are:

- **Baseline migration:** `supabase db pull` to capture the live cloud schema as
  the first file in `supabase/migrations/`.
- **Schema fixes as migrations:** issues #271 and #272 ride the new workflow.

See the roadmap in [supabase-migration-plan.md](supabase-migration-plan.md).
