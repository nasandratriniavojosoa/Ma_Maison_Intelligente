#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
echo "Installation de Ma Maison Intelligente MQTT"
MISSING=""
command -v php >/dev/null 2>&1 || MISSING="$MISSING php"
command -v mosquitto >/dev/null 2>&1 || MISSING="$MISSING mosquitto"
command -v mosquitto_pub >/dev/null 2>&1 || MISSING="$MISSING mosquitto"
if [ -n "$MISSING" ]; then pkg install -y $MISSING; fi
mkdir -p data "$HOME/.config/mosquitto"
chmod 700 data
CFG="$HOME/.config/mosquitto/mosquitto.conf"
if [ ! -f "$CFG" ]; then
  cat > "$CFG" <<'CONF'
listener 1883 0.0.0.0
allow_anonymous true
persistence false
CONF
  echo "Configuration Mosquitto créée : $CFG"
else
  echo "Configuration Mosquitto existante conservée : $CFG"
fi
echo "Vérifiez que la configuration Mosquitto contient listener 1883 0.0.0.0"
echo "Puis démarrez le broker dans un onglet Termux : mosquitto -c ~/.config/mosquitto/mosquitto.conf -v"
echo "Dans un autre onglet, lancez : bash start.sh"
