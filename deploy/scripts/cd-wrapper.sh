#!/bin/bash
# ============================================================================
# cd-wrapper.sh — SSH dispatcher para la deploy key de eval-app
#
# Se invoca desde `authorized_keys` con la restricción:
#   command="/opt/eval/bin/cd-wrapper.sh" ssh-ed25519 AAAA... eval-deploy
#
# Es la ÚNICA superficie de ataque de la deploy key. Aunque la clave se
# filtre, un atacante no puede abrir shell ni ejecutar otros comandos —
# este wrapper acepta solamente los primeros tokens `deploy` (prod) y
# `deploy-staging` (staging), y reenvía el resto verbatim a `cd.sh` con
# los flags de ambiente correctos. Cualquier otra cosa se loggea y se
# rechaza.
#
# Logs: /var/log/eval-cd.log (este wrapper) + /var/log/eval-cd-script.log
#       (cd.sh). Ambos rotan con logrotate externo.
# ============================================================================
set -euo pipefail
LOG=/var/log/eval-cd.log
mkdir -p "$(dirname "$LOG")"
echo "[--BEGIN-- $(date -Iseconds)] user=${USER:-?} cmd=${SSH_ORIGINAL_COMMAND:-<no-command>} key=${SSH_CLIENT%% *}" >> "$LOG"

CMD="${SSH_ORIGINAL_COMMAND:-}"
[ -z "$CMD" ] && {
  echo "deploy key — interactive shell denied" >&2
  echo "[--DENY-- $(date -Iseconds)] reason=no-command key=${SSH_CLIENT%% *}" >> "$LOG"
  exit 1
}

FIRST="${CMD%% *}"
REST="${CMD#${FIRST} }"
case "$FIRST" in
  deploy)
    echo "[--RUN-- $(date -Iseconds)] /opt/eval/bin/cd.sh $REST (env=prod)" >> "$LOG"
    /opt/eval/bin/cd.sh $REST
    RC=$?
    echo "[--END-- $(date -Iseconds)] rc=$RC" >> "$LOG"
    exit $RC
    ;;
  deploy-staging)
    echo "[--RUN-- $(date -Iseconds)] /opt/eval/bin/cd.sh --env-dir /opt/eval/eval-app-staging --env-file .env.staging --compose docker-compose.staging.yml --image-tag-suffix -staging $REST (env=staging)" >> "$LOG"
    /opt/eval/bin/cd.sh --env-dir /opt/eval/eval-app-staging \
                        --env-file .env.staging \
                        --compose docker-compose.staging.yml \
                        --image-tag-suffix -staging \
                        $REST
    RC=$?
    echo "[--END-- $(date -Iseconds)] rc=$RC" >> "$LOG"
    exit $RC
    ;;
  *)
    echo "deploy key — forbidden command: $FIRST" >&2
    echo "[--DENY-- $(date -Iseconds)] first=$FIRST key=${SSH_CLIENT%% *}" >> "$LOG"
    exit 1
    ;;
esac
