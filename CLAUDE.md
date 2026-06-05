# Alexandrie

Fork: https://github.com/JavierLoro/Alexandrie

Separación dev/deploy:
- **Devbox (CT 112)** — este repo, `/root/forks/Alexandrie`. Aquí se desarrolla. `hostname` = `devbox`.
- **Producción (CT 109)** — `/opt/alexandrie/` · Config: `/opt/alexandrie/.env`. **Nunca editar a mano** (ver Deploy).

Base de conocimiento Markdown autoalojada. Monorepo:

- `backend/` — API REST en Go (Gin)
- `frontend/` — app Nuxt 4 (Vue 3, TS, Pinia, SCSS, editor CodeMirror 6)
- `mcp/` — servidor MCP (`alexandrie-mcp`)
- `docs/` — guía de setup y referencia completa de variables de entorno

## Stack y servicios

4 servicios Docker en la red `alexandrie-network` (ver `docker-compose.yml`):

| Servicio  | Rol                 | Puerto (def.) |
| --------- | ------------------- | ------------- |
| Frontend  | Nuxt 4              | 8200          |
| Backend   | API Go/Gin          | 8201          |
| RustFS    | almacenamiento S3   | 9000 / 9005   |
| MySQL 8   | base de datos       | 3307          |

## Desarrollo local

```bash
docker compose up -d                                                       # stack completo
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build  # dev con HMR
```

Por servicio (`Makefile`, el front usa bun):

```bash
make backend     # cd backend && go run main.go   (migraciones auto al arrancar)
make frontend    # cd frontend && nuxt dev
make minio       # almacenamiento local
```

Lint front: `cd frontend && npm run lint` (y `npm run lint:css`).

## Backend (Go, arquitectura por capas)

Flujo de petición: `router/` → `middlewares/` (auth, logging) → `controllers/` (parse/validación) → `services/` (lógica) → `repositories/` (DB) → respuesta.

Añadir feature: model → repository → service → controller → registrar ruta en `router/routes/`.
Migraciones en `backend/app/migrations/` (auto al arrancar). Config avanzada: `backend/config.toml` vía `CONFIG_PATH`.

## MCP server (`mcp/`)

`alexandrie-mcp` — expone nodos/documentos sobre la API. `npm run build` / `npm run dev`. El renderer Markdown se sincroniza desde el frontend (`scripts/sync-renderer.mjs`, prebuild).

## Deploy (dev → CT 109, vía GitHub)

1. En la devbox (CT 112): commit + `git push origin main`.
2. Desplegar en CT 109, **desde el nodo Proxmox**:
   ```bash
   pct exec 109 -- /usr/local/bin/deploy-alexandrie
   ```
   El script hace `git pull --ff-only` en `/opt/alexandrie` y reconstruye **solo lo que cambió** (frontend / backend / compose / `mcp/**`).

Reglas:
- **NO** editar directamente en `/opt/alexandrie` (CT 109) ni vía `pct mount` — solo en la devbox. (`pct mount` deja archivos con uid host-root → rompe git.)
- El MCP (`mcp/`) lo cubre `deploy-alexandrie`; los secretos del token quedan fuera de git en `/opt/alexandrie-mcp/` (CT 109).
- Nunca `fuser -k` sobre el rootfs del CT.

## Variables / flags

Referencia completa en `docs/README.md` y `.env.example`. Activos en CT 109:

- `CONFIG_DISABLE_SIGNUP=true`
- `CONFIG_DISABLE_LANDING=true`

Otras relevantes: `CONFIG_DISABLE_NATIVE_LOGIN`, OIDC (`OIDC_{1..10}_*`), `ADMIN_ACCOUNTS`, `JWT_SECRET`, `MINIO_SECURE` / `MINIO_CA_PATH`.

## Gotchas

- Volúmenes (`mysql_data`, `rustfs_data`): **nunca** usar `docker compose down -v` en producción.
- `COOKIE_DOMAIN`: dominio común más alto entre front y back, **sin** protocolo. Mal configurado = login aparente seguido de logout inmediato.
