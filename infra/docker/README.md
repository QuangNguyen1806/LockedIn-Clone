# Deployment

## Docker Compose (local)

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

## API service

Build from repo root:

```bash
docker build -f infra/docker/Dockerfile.api -t lockedin-api services/api
docker build -f infra/docker/Dockerfile.worker -t lockedin-worker services
```

## Worker service

```bash
cd services/worker
source ../api/.venv/bin/activate
pip install -r requirements.txt
python3 -m worker.main
```

## Environment variables

Copy `.env.example` to `.env` at repo root. Key settings:

- `USE_MOCK_AI=true` for local dev without API keys
- `DATABASE_URL` for Postgres connection
- `JWT_SECRET` must be changed in production
- `SENTRY_DSN` optional for error tracking

## Desktop packaging

Requires Rust (`rustup`). From repo root:

```bash
npm install
npm run build:desktop
npm run tauri build --workspace=@lockedin/desktop
```

Build artifacts appear under `apps/desktop/src-tauri/target/release/bundle/`.

## Privacy controls

Users can enable "delete session data immediately after each session" in the web profile settings. Session deletion is available from the history API.

## Rate limiting

The `/health` endpoint is rate-limited via SlowAPI. Extend limiter usage to auth endpoints in production.
