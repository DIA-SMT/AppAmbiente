#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Despliega Residuos SMT en la VPS. Va en /srv/ambiente/desplegar.sh y se
# corre como root:
#
#     bash /srv/ambiente/desplegar.sh            # el último commit de main
#     bash /srv/ambiente/desplegar.sh volver     # vuelve a la versión anterior
#
# Desde Windows se llama sólo al script (ssh … "bash /srv/ambiente/desplegar.sh"):
# PowerShell rompe las comillas de los comandos largos que se mandan por SSH.
#
# Cada despliegue es una carpeta nueva en versiones/ con fecha y commit, y el
# enlace «actual» apunta a la que está viva. Se guardan las tres últimas.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

PROYECTO=ambiente
REPO=https://github.com/DIA-SMT/AppAmbiente.git
RAMA=main
RAIZ=/srv/$PROYECTO

# sudo conserva la carpeta actual, y una sesión SSH arranca en /root, donde el
# usuario del proyecto no puede entrar: pm2 falla con «spawn node EACCES».
cd "$RAIZ"

como() { sudo -u "$PROYECTO" -H "$@"; }

if [[ "${1:-}" == "volver" ]]; then
  vigente=$(readlink -f actual)
  anterior=$(ls -dt versiones/*/ | sed 's:/$::' | while read -r v; do
    [[ "$(readlink -f "$v")" != "$vigente" ]] && { echo "$v"; break; }
  done)
  [[ -n "$anterior" ]] || { echo "No hay una versión anterior."; exit 1; }
  ln -sfn "$RAIZ/$anterior" actual
  como pm2 reload "$PROYECTO"
  echo "Volvió a $anterior"
  exit 0
fi

[[ -f compartido/.env ]] || { echo "Falta $RAIZ/compartido/.env (paso 2 del README)."; exit 1; }

SHA=$(git ls-remote "$REPO" "refs/heads/$RAMA" | cut -c1-7)
VER=versiones/$(date +%Y%m%d-%H%M%S)-$SHA
echo "Desplegando $RAMA @ $SHA en $VER"

como git clone --quiet --depth 1 --branch "$RAMA" "$REPO" "$VER"
cd "$VER"
como ln -s ../../compartido/.env .env
como npm ci --no-audit --no-fund
como npm run build

cd "$RAIZ"
ln -sfn "$RAIZ/$VER" actual

if como pm2 describe "$PROYECTO" > /dev/null 2>&1; then
  como pm2 reload "$PROYECTO"
else
  como pm2 start "$RAIZ/ecosystem.config.cjs"
  como pm2 save
fi

# Las tres últimas versiones; el disco no es infinito.
ls -dt versiones/*/ | tail -n +4 | xargs -r rm -rf

echo
echo "Listo: $VER"
echo "Revisá: curl -s https://ambiente.195-35-42-168.sslip.io/api/salud"
