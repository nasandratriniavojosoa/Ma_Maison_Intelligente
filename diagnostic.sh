#!/data/data/com.termux/files/usr/bin/bash
# À lancer dans un 2e onglet Termux pendant que « bash start.sh » tourne.
cd "$(dirname "$0")"
echo "1) Version de PHP :"; php -v | head -1
echo ""
echo "2) Syntaxe du relais (api/esp.php) :"; php -l api/esp.php
echo ""
echo "3) Extension curl de PHP :"; (php -m | grep -i '^curl$') || echo "absente (le mode de repli sera utilisé : normal)"
echo ""
echo "4) Réponse du serveur local (attendu : {\"ok\":true,\"config\":{...}}) :"
if command -v curl >/dev/null 2>&1; then
  curl -s -m 5 -w "\n[HTTP %{http_code}]\n" -X POST http://127.0.0.1:8000/api/esp.php \
    -H 'X-MMI: 1' -H 'Content-Type: application/json' -d '{"action":"config_get"}' \
    || echo "Aucune réponse : le serveur ne tourne pas. Lancez « bash start.sh » dans le 1er onglet."
else
  echo "curl absent. Installez-le : pkg install -y curl"
fi
