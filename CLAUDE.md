# Alexandrie — CT 109

Fork: https://github.com/JavierLoro/Alexandrie · Código: `/opt/alexandrie/` · Config: `/opt/alexandrie/.env`

## Deploy (build local, no GitHub)

```bash
# Desde la máquina de desarrollo, en la raíz del fork:
./deploy.sh            # backend + frontend
./deploy.sh backend    # solo backend
./deploy.sh frontend   # solo frontend
```

Flujo: `docker build` → `docker save` → `ssh` host Proxmox → `pct push` CT → `docker load` → `docker compose up -d --no-build`  
Script servidor: `/usr/local/bin/alexandrie-deploy` (en el host Proxmox)

## Flags activos

- `CONFIG_DISABLE_SIGNUP=true`
- `CONFIG_DISABLE_LANDING=true`

> Volúmenes (`mysql_data`, `rustfs_data`): nunca usar `docker compose down -v` en producción.
