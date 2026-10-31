Ma Maison Intelligente v1.4 MQTT

Projet de maison domotique miniature utilisant des cartes ESP32 et Arduino UNO, une interface Web progressive (PWA), PHP et MQTT.

L'objectif est de contrôler et d'automatiser plusieurs fonctions de la maison : éclairage, détection de présence, surveillance de l'environnement, sécurité, accès RFID, ascenseur miniature et gestion de l'énergie solaire.

«État du projet : plusieurs programmes et fonctions sont développés séparément. Leur présence dans le dépôt ne signifie pas que toutes les fonctions sont déjà intégrées et validées ensemble.»

---

1. Présentation générale

Le projet reproduit une maison miniature comportant plusieurs pièces et équipements :

- Éclairage de plusieurs zones.
- Détection de présence.
- Gestion automatique de l'éclairage selon la luminosité.
- Détection de fumée et de flamme.
- Alarme sonore et alerte incendie.
- Contrôle d'accès par RFID.
- Ascenseur miniature.
- Suivi solaire et détection de pluie.
- Ventilation et surveillance de température/humidité.

Le projet utilise plusieurs microcontrôleurs afin de répartir les fonctions entre différents modules.

2. Architecture générale

Architecture de la partie MQTT

La communication entre l'application et le premier ESP32 suit cette architecture :

Téléphone Android
       |
       v
PWA dans Chrome
       |
       v
Serveur PHP local
localhost:8000
       |
       v
Mosquitto MQTT
127.0.0.1:1883
       |
       v
ESP32 n°1
Domotique principale

Le téléphone Android utilise Termux pour héberger les services locaux nécessaires.

Le réseau local peut être créé avec le point d'accès Wi-Fi du téléphone. Cette architecture permet un fonctionnement local sans dépendre d'un serveur Internet.

Important : l'adresse IP du téléphone peut changer après une reconnexion du point d'accès. Il faut donc la vérifier avant de modifier l'adresse du broker dans un programme.

Cartes utilisées

Carte| Fonction
ESP32 n°1| Domotique principale et MQTT
ESP32 n°2| Contrôle d'accès RFID
Arduino UNO n°1| Suivi solaire et détection de pluie
Arduino UNO n°2| Ascenseur miniature et ventilation

Les communications MQTT documentées concernent principalement l'ESP32 n°1. L'intégration des autres cartes à l'application doit être considérée séparément.

3. ESP32 n°1 — Domotique principale

Programme :

"programmes/ESP32_1_Domotique_MQTT/ESP32_1_Domotique_MQTT.ino"

Fonctions

- Commande des sept zones d'éclairage.
- Détection de présence avec PIR.
- Gestion de la luminosité avec une photorésistance.
- Modes automatique et manuel.
- Détection de fumée avec MQ-2.
- Détection de flamme avec KY-026.
- Commande d'un buzzer pour l'alerte incendie.
- Communication MQTT avec l'application.

Broches documentées

Composant| Broche ESP32
LED 1| GPIO 2
LED 2| GPIO 4
LED 3| GPIO 5
LED 4| GPIO 18
LED 5| GPIO 19
LED 6| GPIO 21
LED 7| GPIO 22
Capteur PIR| GPIO 27
LED de présence| GPIO 26
Photorésistance LDR| GPIO 34
Capteur MQ-2| GPIO 25
Capteur de flamme KY-026| GPIO 32
Buzzer| GPIO 33

Les broches ci-dessus sont les affectations documentées du programme principal. Toute modification doit être vérifiée dans le code avant le câblage.

Gestion automatique de l'éclairage

Le programme utilise deux seuils :

- "seuilSombre = 1200"
- "seuilClair = 1800"

Le système distingue les modes :

- "AUTO" : gestion automatique selon la luminosité.
- "MANUEL" : commande manuelle.

Commandes MQTT documentées

Commande| Fonction
"MODE:AUTO"| Active le mode automatique
"ALL:ON"| Allume toutes les LED
"ALL:OFF"| Éteint toutes les LED
"LED:index:ON"| Allume une LED
"LED:index:OFF"| Éteint une LED

L'indexation des LED dépend du programme ESP32.

Topics MQTT

Topic| Utilisation
"maison/commande"| Réception des commandes
"maison/etat"| Publication de l'état du système
"maison/presence"| Informations de présence
"maison/connexion"| État de connexion de l'ESP32
"maison/incendie"| Informations relatives à l'incendie

Le programme utilise PubSubClient et configure notamment une taille de tampon MQTT de 512 octets.

4. ESP32 n°2 — Contrôle d'accès RFID

Programme :

"programmes/ESP32_2_RFID/RFID_Porte.ino"

Composants

- ESP32 DevKit.
- Lecteur RFID RC522.
- Carte ou badge RFID.
- Servomoteur MG90S.

Fonctionnement prévu

1. Le lecteur RFID détecte une carte.
2. Le programme lit son identifiant.
3. Il vérifie si cet identifiant est autorisé.
4. Si l'accès est autorisé, le servomoteur actionne la porte.
5. La porte se referme automatiquement après le délai prévu dans le programme.

Le programme RFID est séparé du programme de domotique principale.

État d'intégration : le fonctionnement autonome du module et son intégration à l'application ou à MQTT doivent être validés séparément. Ne pas considérer cette intégration comme acquise simplement parce que le programme RFID existe.

5. Arduino UNO n°1 — Suivi solaire et détection de pluie

Programme :

"programmes/Arduino_UNO_Solaire_Pluie/Solaire_Pluie.ino"

Fonctions prévues

- Mesure de la luminosité avec des photorésistances.
- Orientation d'un panneau solaire avec un servomoteur.
- Détection de pluie.
- Actionnement d'un servomoteur en fonction de la détection de pluie.

Broches documentées

Composant| Broche Arduino UNO
Photorésistance 1| A0
Photorésistance 2| A1
Servomoteur solaire| D9
Capteur de pluie| D2
Servomoteur associé à la pluie| D3

Le comportement exact doit être vérifié avec le programme et le montage réels avant toute modification.

6. Arduino UNO n°2 — Ascenseur et ventilation

Programme :

"programmes/Arduino_UNO_Ascenseur_Ventillateur/Ascenseur_Ventillateur.ino"

Fonctions prévues

- Mesure de température et d'humidité avec DHT22.
- Gestion d'une ventilation par relais.
- Mesure de distance avec un capteur ultrasonique HC-SR04.
- Commande du moteur de l'ascenseur avec un driver moteur.
- Sélection des étages avec des boutons physiques.

Broches documentées

Composant| Broche Arduino UNO
DHT22| D2
Relais| D8
HC-SR04 TRIG| D11
HC-SR04 ECHO| D12
Boutons de commande| D10, D3, D4
Driver ENA| D5
Driver IN1| D6
Driver IN2| D7

Le driver moteur et le câblage doivent être vérifiés sur le montage réel. Les broches indiquées ne doivent pas être modifiées sans vérifier les conséquences sur le programme.

7. Application Web progressive (PWA)

L'interface est destinée à être utilisée depuis Chrome sur Android et peut être ajoutée à l'écran d'accueil.

Fichiers principaux :

- "index.html" : interface principale.
- "assets/js/app.js" : logique de l'application.
- "assets/js/esp.js" : fonctions liées à l'ESP32.
- "api/esp.php" : relais PHP des commandes et états.
- "manifest.webmanifest" : configuration de la PWA.
- "sw.js" : service worker et cache de l'application.
- "router.php" : routage PHP local.

La PWA n'est pas une application Android native APK.

Audio d'alerte

Le dossier "assets/audio/" contient notamment :

- "incendie.mp3"
- "alerte-incendie.mp3"

Le fichier "incendie.mp3" est référencé dans le code de l'application pour l'alerte incendie. La présence de l'autre fichier ne signifie pas nécessairement qu'il est utilisé actuellement.

8. Environnement de développement

Le développement et l'exploitation locale utilisent principalement :

- Android.
- Termux.
- ArduinoDroid.
- PHP.
- Mosquitto.
- "mosquitto_pub".
- "mosquitto_sub".
- Chrome.

Le projet est conçu pour pouvoir être développé et utilisé sans dépendre systématiquement d'un ordinateur.

Services locaux

Les principaux services de l'architecture MQTT sont :

Service| Adresse ou port
Serveur PHP| "localhost:8000"
Mosquitto MQTT| "127.0.0.1:1883"
WebSocket Mosquitto configuré| Port "9001"

Le port WebSocket est présent dans la configuration du broker. Il ne constitue pas une étape obligatoire dans l'architecture PWA → PHP → MQTT décrite plus haut.

Scripts disponibles

- "setup.sh" : script de préparation du projet.
- "start.sh" : script de démarrage.
- "diagnostic.sh" : diagnostic.
- "sauvegarde.sh" : sauvegarde.

Consulter le contenu des scripts avant de les modifier.

9. Organisation du dépôt

MaMaisonIntelligente_v1.4_MQTT/
│
├── README.md
│
├── index.html
├── router.php
├── manifest.webmanifest
├── sw.js
│
├── api/
│   └── esp.php
│
├── assets/
│   ├── js/
│   │   ├── app.js
│   │   └── esp.js
│   │
│   └── audio/
│       ├── incendie.mp3
│       └── alerte-incendie.mp3
│
├── programmes/
│   ├── ESP32_1_Domotique_MQTT/
│   │   └── ESP32_1_Domotique_MQTT.ino
│   │
│   ├── ESP32_2_RFID/
│   │   └── RFID_Porte.ino
│   │
│   ├── Arduino_UNO_Solaire_Pluie/
│   │   └── Solaire_Pluie.ino
│   │
│   └── Arduino_UNO_Ascenseur_Ventillateur/
│       └── Ascenseur_Ventillateur.ino
│
├── firmware/
│   └── secrets.example.h
│
├── tests/
│
├── setup.sh
├── start.sh
├── diagnostic.sh
├── sauvegarde.sh
│
└── .gitignore

Certains fichiers locaux, sauvegardes et données de configuration peuvent ne pas être suivis par Git. Cette arborescence présente les principaux éléments du projet et non nécessairement tous les fichiers présents sur le téléphone.

10. Configuration et protection des informations

Les informations privées de configuration doivent rester dans les fichiers locaux "secrets.h".

Le dépôt contient un modèle :

"firmware/secrets.example.h"

Les fichiers locaux "secrets.h" ne doivent pas être publiés sur GitHub.

Avant un commit ou un push, vérifier que les fichiers contenant des identifiants, mots de passe ou autres informations privées sont bien exclus par ".gitignore".

Ne jamais publier de mot de passe Wi-Fi, identifiant privé ou information de connexion MQTT.

11. État d'avancement

Les statuts ci-dessous distinguent l'existence des programmes de leur validation sur le matériel et de leur intégration complète.

Module| État documentaire
Éclairage avec 7 LED| Programme principal présent
PIR et détection de présence| Programme principal présent
LDR et mode automatique| Programme principal présent
Communication MQTT de l'ESP32 n°1| Architecture et programme présents
Détection de fumée MQ-2| Programme principal présent
Détection de flamme KY-026| Programme principal présent
Alerte sonore et incendie| Code et fichiers audio présents
Contrôle RFID| Programme autonome présent
Suivi solaire et pluie| Programme Arduino UNO présent
Ascenseur et ventilation| Programme Arduino UNO présent
Intégration RFID dans l'application| À valider
Intégration de toutes les cartes dans un système unique| À réaliser et tester

La présence d'un programme dans le dépôt ne prouve pas à elle seule que le montage fonctionne dans toutes les conditions. Les tests électriques, les essais individuels et les essais d'intégration restent nécessaires.

12. Tests et maintenance

Avant toute modification importante :

1. Sauvegarder les fichiers concernés.
2. Vérifier les broches utilisées dans le programme.
3. Vérifier l'alimentation des cartes et des actionneurs.
4. Tester chaque module indépendamment.
5. Vérifier les échanges MQTT.
6. Vérifier le fonctionnement de l'application.
7. Tester l'ensemble après intégration.

Pour les modifications du programme principal ESP32, préserver en particulier les sept sorties LED, le PIR, la LED de présence, la LDR et les fonctions MQTT déjà existantes.

13. Objectif final

L'objectif est de réaliser une maquette domotique modulaire, évolutive et utilisable localement.

À terme, les différents modules devront fonctionner ensemble de manière cohérente, avec une interface centralisée, des commandes physiques et des automatismes adaptés aux équipements de la maison.

Ma Maison Intelligente v1.4 MQTT — une maison miniature connectée, modulaire et évolutive.

## Installation et démarrage

### 1. Préparer le projet

```bash
cd ~/MaMaisonIntelligente_v1.4_MQTT
bash setup.sh


### 2. Démarrer Mosquitto

Ouvrir un nouvel onglet Termux et exécuter :

```bash
mosquitto -c ~/.config/mosquitto/mosquitto.conf -v
```

Laisser ce terminal ouvert pendant l'utilisation du système.

### 3. Démarrer le serveur PHP

Dans un autre onglet Termux, exécuter :

```bash
cd ~/MaMaisonIntelligente_v1.4_MQTT
bash start.sh
```

### 4. Ouvrir l'application

Ouvrir Chrome sur le téléphone et accéder à :

http://localhost:8000

L'application peut ensuite être ajoutée à l'écran d'accueil depuis le menu de Chrome.

### 5. Tester la communication MQTT

Ces tests nécessitent que Mosquitto soit démarré et que l'ESP32 soit connecté au broker.

Pour écouter les états publiés par l'ESP32 :

```bash
mosquitto_sub -h 127.0.0.1 -t maison/etat -v
```

Pour allumer toutes les LED :

```bash
mosquitto_pub -h 127.0.0.1 -t maison/commande -m 'ALL:ON'
```

Pour éteindre toutes les LED :

```bash
mosquitto_pub -h 127.0.0.1 -t maison/commande -m 'ALL:OFF'
```

### 6. Vérifier l'adresse IP du téléphone

L'adresse IP du téléphone peut changer après une reconnexion du point d'accès Wi-Fi.

Pour vérifier l'adresse actuelle dans Termux :

```bash
ifconfig
```

Repérer l'adresse IPv4 de l'interface `ap0`.

Si l'adresse IP change, vérifier et mettre à jour l'adresse du broker dans le programme ESP32 concerné avant de téléverser le code.

### 7. Arrêter les services

Pour arrêter Mosquitto ou le serveur PHP, revenir dans le terminal correspondant et utiliser :

```text
CTRL + C
```

---

## Sécurité et sauvegardes

- Ne jamais publier les mots de passe, clés privées ou fichiers contenant des informations sensibles.
- Conserver les fichiers `secrets.h` localement.
- Utiliser uniquement `secrets.example.h` comme modèle public.
- Faire une sauvegarde avant toute modification importante du firmware ou de l'application.
- Ne pas modifier les broches déjà utilisées sans vérifier les conséquences sur les autres modules.

## État du développement

Le projet contient plusieurs programmes et modules développés séparément.

La présence d'un programme dans le dépôt ne signifie pas automatiquement que son intégration complète avec l'application ou les autres cartes est terminée et validée.

Les prochaines étapes comprennent notamment :

- Finaliser l'intégration RFID avec MQTT et l'application.
- Vérifier la communication entre les deux ESP32.
- Poursuivre les essais des modules Arduino UNO.
- Effectuer des tests complets du système.
- Améliorer la documentation et les procédures de maintenance.
