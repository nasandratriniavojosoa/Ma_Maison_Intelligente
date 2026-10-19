#!/data/data/com.termux/files/usr/bin/bash
# Usage : bash start.sh          -> accessible seulement depuis CE téléphone (recommandé)
#         bash start.sh --lan    -> accessible aussi depuis le réseau local (à éviter)
cd "$(dirname "$0")"
PORT=8000
BIND="127.0.0.1"
if [ "$1" = "--lan" ]; then
    BIND="0.0.0.0"
    echo "⚠️  Mode --lan : toute personne sur votre réseau pourra commander la maison."
fi
# Empêche Android d'endormir Termux (sinon le serveur s'arrête en arrière-plan)
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
# Plusieurs processus : un ESP32 lent ne bloque pas l'interface
export PHP_CLI_SERVER_WORKERS=4
echo ""
echo "=================================================="
echo "  Ouvrez dans Chrome :  http://localhost:$PORT"
echo "  (Ctrl+C pour arrêter le serveur)"
echo "=================================================="
echo ""
exec php -S "$BIND:$PORT" router.php
