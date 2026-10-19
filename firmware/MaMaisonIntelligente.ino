#include "secrets.h"
#include <WiFi.h>
#include <PubSubClient.h>

// 1. WI-FI



// 2. MQTT
const char* mqtt_server = "10.94.153.119";
const uint16_t mqtt_port = 1883;

const char* topic_command   = "maison/commande";
const char* topic_state     = "maison/etat";
const char* topic_presence  = "maison/presence";
const char* topic_connexion = "maison/connexion";

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// 3. LES 7 LED
const int ledPins[7] = {2, 4, 5, 18, 19, 21, 22};
bool ledStates[7] = {false, false, false, false, false, false, false};

// 4. PIR ET LED DE PRÉSENCE
const int pirPin = 27;
const int ledPresencePin = 26;

bool presenceDetectee = false;
bool etatLedPresence = false;

unsigned long dernierClignotement = 0;
unsigned long dernierEtat = 0;
unsigned long derniereTentativeWiFi = 0;
unsigned long derniereTentativeMQTT = 0;

// 5. PHOTORÉSISTANCE LDR
const int ldrPin = 34;

// Branchement prévu : 3V3 -> LDR -> GPIO34 -> 10kΩ -> GND
const int seuilSombre = 1200;
const int seuilClair = 1800;

int valeurLDR = 0;
bool modeAuto = true;

unsigned long derniereLectureLDR = 0;
unsigned long dernierDebugLDR = 0;

const unsigned long intervalleLDR = 250;
const unsigned long intervalleDebugLDR = 2000;

const unsigned long intervalleClignotement = 500;
const unsigned long intervalleEtat = 30000;
const unsigned long intervalleWiFi = 10000;
const unsigned long intervalleMQTT = 5000;

// 6. PUBLICATION DE L'ÉTAT
void publishState() {
  if (!mqtt.connected()) return;

  String body = "{\"leds\":[";

  for (int i = 0; i < 7; i++) {
    if (i > 0) body += ",";

    body += "{\"index\":";
    body += String(i);
    body += ",\"number\":";
    body += String(i + 1);
    body += ",\"gpio\":";
    body += String(ledPins[i]);
    body += ",\"on\":";
    body += (ledStates[i] ? "true" : "false");
    body += "}";
  }

  body += "],\"presence\":";
  body += (presenceDetectee ? "true" : "false");
  body += ",\"mode\":\"";
  body += (modeAuto ? "AUTO" : "MANUEL");
  body += "\",\"ldr\":";
  body += String(valeurLDR);
  body += "}";

  bool ok = mqtt.publish(topic_state, body.c_str(), true);
  mqtt.publish(topic_presence, presenceDetectee ? "1" : "0", true);

  Serial.println(ok ? "État MQTT publié." : "Échec publication état.");
}

// 7. COMMANDES DES LED
bool setAll(bool on) {
  bool changed = false;

  for (int i = 0; i < 7; i++) {
    if (ledStates[i] != on) {
      ledStates[i] = on;
      digitalWrite(ledPins[i], on ? HIGH : LOW);
      changed = true;
    }
  }

  return changed;
}

// Applique automatiquement la luminosité
bool appliquerAuto() {
  if (!modeAuto) return false;

  if (valeurLDR <= seuilSombre) {
    return setAll(true);
  }

  if (valeurLDR >= seuilClair) {
    return setAll(false);
  }

  return false;
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != topic_command ||
      length == 0 || length > 40) {
    return;
  }

  String cmd;
  for (unsigned int i = 0; i < length; i++) {
    cmd += (char)payload[i];
  }

  cmd.trim();
  cmd.toUpperCase();

  Serial.print("Commande reçue : ");
  Serial.println(cmd);

  if (cmd == "MODE:AUTO") {
    modeAuto = true;
    appliquerAuto();
    Serial.println("Mode AUTOMATIQUE activé.");
    publishState();
    return;
  }

  if (cmd == "ALL:ON") {
    modeAuto = false;
    setAll(true);
    Serial.println("Mode MANUEL : toutes les LED allumées.");
    publishState();
    return;
  }

  if (cmd == "ALL:OFF") {
    modeAuto = false;
    setAll(false);
    Serial.println("Mode MANUEL : toutes les LED éteintes.");
    publishState();
    return;
  }

  if (cmd.startsWith("LED:")) {
    int separateur = cmd.indexOf(':', 4);

    if (separateur > 4) {
      int index = cmd.substring(4, separateur).toInt();
      String valeur = cmd.substring(separateur + 1);

      if (index >= 0 && index < 7 &&
          (valeur == "ON" || valeur == "OFF")) {

        modeAuto = false;

        ledStates[index] = (valeur == "ON");
        digitalWrite(
          ledPins[index],
          ledStates[index] ? HIGH : LOW
        );

        Serial.println("Mode MANUEL activé.");
        publishState();
        return;
      }
    }
  }

  Serial.println("Commande inconnue ou invalide.");
}

// 8. RECONNEXION WI-FI
void gererWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long maintenant = millis();

  if (maintenant - derniereTentativeWiFi >= intervalleWiFi) {
    derniereTentativeWiFi = maintenant;

    Serial.println("Wi-Fi absent : nouvelle tentative...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }
}

// 9. RECONNEXION MQTT AVEC LWT
void gererMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }

  unsigned long maintenant = millis();

  if (maintenant - derniereTentativeMQTT < intervalleMQTT) {
    return;
  }

  derniereTentativeMQTT = maintenant;

  Serial.print("Connexion MQTT... ");

  bool ok = mqtt.connect(
    "MMI-ESP32-maison",
    topic_connexion,
    1,
    true,
    "offline"
  );

  if (ok) {
    Serial.println("OK");

    mqtt.publish(topic_connexion, "online", true);

    if (mqtt.subscribe(topic_command)) {
      Serial.println("Abonné à maison/commande.");
    }

    publishState();
  } else {
    Serial.print("Échec MQTT, code = ");
    Serial.println(mqtt.state());
  }
}

// 10. INITIALISATION
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 7; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }

  pinMode(ldrPin, INPUT);
  analogReadResolution(12);

  pinMode(pirPin, INPUT);
  pinMode(ledPresencePin, OUTPUT);
  digitalWrite(ledPresencePin, LOW);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  mqtt.setServer(mqtt_server, mqtt_port);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(2);
  mqtt.setKeepAlive(20);

  Serial.println("Démarrage MaMaisonIntelligente MQTT + LDR...");
  Serial.println("Mode automatique actif au démarrage.");
  Serial.println("LDR sur GPIO 34.");

  WiFi.begin(ssid, password);
  derniereTentativeWiFi = millis();

  Serial.print("Broker : ");
  Serial.print(mqtt_server);
  Serial.print(":");
  Serial.println(mqtt_port);
}

// 11. BOUCLE PRINCIPALE
void loop() {
  gererWiFi();
  gererMQTT();

  unsigned long maintenant = millis();

  if (maintenant - derniereLectureLDR >= intervalleLDR) {
    derniereLectureLDR = maintenant;

    valeurLDR = analogRead(ldrPin);

    if (modeAuto && appliquerAuto()) {
      Serial.println(
        valeurLDR <= seuilSombre
          ? "Obscurité : LED allumées automatiquement."
          : "Clarté : LED éteintes automatiquement."
      );

      publishState();
    }
  }

  if (maintenant - dernierDebugLDR >= intervalleDebugLDR) {
    dernierDebugLDR = maintenant;

    Serial.print("LDR = ");
    Serial.print(valeurLDR);
    Serial.print(" | Mode = ");
    Serial.println(modeAuto ? "AUTO" : "MANUEL");
  }

  // Gestion du PIR
  bool mouvement = (digitalRead(pirPin) == HIGH);

  if (mouvement) {
    if (!presenceDetectee) {
      presenceDetectee = true;
      etatLedPresence = true;
      dernierClignotement = maintenant;

      digitalWrite(ledPresencePin, HIGH);
      Serial.println("Mouvement détecté.");
      publishState();
    }

    if (maintenant - dernierClignotement >= intervalleClignotement) {
      dernierClignotement = maintenant;
      etatLedPresence = !etatLedPresence;

      digitalWrite(
        ledPresencePin,
        etatLedPresence ? HIGH : LOW
      );
    }
  } else if (presenceDetectee) {
    presenceDetectee = false;
    etatLedPresence = false;

    digitalWrite(ledPresencePin, LOW);
    Serial.println("Plus de mouvement.");
    publishState();
  }

  if (mqtt.connected() &&
      maintenant - dernierEtat >= intervalleEtat) {
    dernierEtat = maintenant;
    publishState();
  }

  delay(2);
}
