# Ma Maison Intelligente v1.4 MQTT — Android + Termux + ArduinoDroid

Cette version conserve l’interface PWA de v1.3 mais remplace la liaison application→ESP32 par un relais MQTT local : PWA → PHP sur `localhost:8000` → Mosquitto TCP `127.0.0.1:1883` → ESP32. Aucun WebSocket n’est nécessaire pour cette architecture. Le relais PHP utilise `mosquitto_pub` et `mosquitto_sub`.

## Important — avant de téléverser
- Le firmware MQTT est dans `programmes/MaMaisonIntelligente/MaMaisonIntelligente.ino`.
- Il nécessite la bibliothèque **PubSubClient** (auteur knolleary) dans ArduinoDroid.
- Le SSID et le mot de passe du hotspot sont des valeurs de remplacement dans le fichier. Renseignez-les localement.
- `mqtt_server` doit être l’adresse IPv4 du téléphone sur le réseau du hotspot, par exemple `10.91.34.2` seulement si `ifconfig` confirme encore cette adresse sur `ap0`.
- Mosquitto est configuré en accès anonyme pour le réseau local : utilisez-le uniquement sur votre hotspot de confiance et ne transférez pas le port 1883 vers Internet.

## Installation Termux
1. Décompressez le ZIP dans le dossier personnel Termux.
2. Exécutez `bash setup.sh`.
3. Dans un premier onglet Termux, démarrez le broker :
   `mosquitto -c ~/.config/mosquitto/mosquitto.conf -v`
4. Dans un deuxième onglet, allez dans le dossier du projet et lancez `bash start.sh`.
5. Ouvrez `http://localhost:8000` dans Chrome.
6. Dans Réglages, saisissez l’adresse IPv4 de l’interface `ap0` du téléphone et le port `1883`. Cette même adresse doit être utilisée dans `mqtt_server` du firmware.

## Installation ArduinoDroid
1. Importez la bibliothèque PubSubClient depuis son dépôt officiel : https://github.com/knolleary/pubsubclient (si ArduinoDroid demande une archive ZIP, utilisez le ZIP du dépôt).
2. Ouvrez `programmes/MaMaisonIntelligente/MaMaisonIntelligente.ino`.
3. Renseignez `ssid`, `password` et `mqtt_server`.
4. Téléversez le firmware sur l’ESP32.
5. Ouvrez le moniteur série à 115200 bauds. Vérifiez la connexion Wi-Fi et MQTT.

## Topics MQTT
- `maison/commande` : `ALL:ON`, `ALL:OFF`, `LED:0:ON`, `LED:0:OFF` jusqu’à `LED:6:ON/OFF`.
- `maison/etat` : JSON retained avec les 7 états et la présence.
- `maison/presence` : `0` ou `1`, retained.

## Vérification manuelle
Dans un troisième onglet Termux :
- État : `mosquitto_sub -h 127.0.0.1 -t maison/etat -v -C 1 -W 3`
- Commande de test : `mosquitto_pub -h 127.0.0.1 -t maison/commande -m ALL:ON`
- Vérifiez ensuite l’état avec la commande précédente.

## Architecture et limites
Le broker est sur le téléphone, et le firmware ESP32 se connecte à l’adresse locale du téléphone sur le hotspot. L’application web ne se connecte pas directement à MQTT : PHP relaie les commandes via les exécutables Mosquitto. La version prépare ce flux mais **n’a pas été testée sur ton appareil réel** ; la première validation doit être faite avec les commandes manuelles avant d’utiliser les boutons de l’application. Les capteurs autres que le PIR et la caméra restent non intégrés.
