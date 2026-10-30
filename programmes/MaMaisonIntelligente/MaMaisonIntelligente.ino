#include "secrets.h"
#include <WiFi.h>
#include <PubSubClient.h>

// 2. MQTT : adresse actuelle du broker, à vérifier après reconnexion
const char* mqtt_server = "10.128.71.6";
const uint16_t mqtt_port = 1883;

const char* topic_command = "maison/commande";
const char* topic_state = "maison/etat";
const char* topic_presence = "maison/presence";
const char* topic_connexion = "maison/connexion";
const char* topic_incendie = "maison/incendie";

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// 3. LES 7 LED
const int ledPins[7] = {2, 4, 5, 18, 19, 21, 22};
bool ledStates[7] = {false, false, false, false, false, false, false};

// 4. PIR ET LED DE PRESENCE
const int pirPin = 27;
const int ledPresencePin = 26;

bool presenceDetectee = false;
bool etatLedPresence = false;
unsigned long dernierClignotement = 0;

// 5. LDR
const int ldrPin = 34;
const int seuilSombre = 1200;
const int seuilClair = 1800;

int valeurLDR = 0;
bool modeAuto = true;

unsigned long derniereLectureLDR = 0;
unsigned long dernierDebugLDR = 0;

// 6. INCENDIE
const int pinFumee = 25;    // MQ-2 : DO
const int pinFlamme = 32;   // KY-026 : DO
const int pinBuzzer = 33;   // Pilote du buzzer 5 V

bool fumeeDetectee = false;
bool flammeDetectee = false;
bool incendieDetecte = false;

// Filtrage : le signal doit rester stable 150 ms
const unsigned long filtreCapteur = 150;
int derniereLectureFumee = HIGH;
int derniereLectureFlamme = HIGH;
int etatStableFumee = HIGH;
int etatStableFlamme = HIGH;
unsigned long changementFumee = 0;
unsigned long changementFlamme = 0;

unsigned long dernierEtat = 0;
unsigned long derniereTentativeWiFi = 0;
unsigned long derniereTentativeMQTT = 0;

const unsigned long intervalleLDR = 250;
const unsigned long intervalleDebugLDR = 2000;
const unsigned long intervalleClignotement = 500;
const unsigned long intervalleEtat = 30000;
const unsigned long intervalleWiFi = 10000;
const unsigned long intervalleMQTT = 5000;

// 7. PUBLICATION DE L'ETAT
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
  body += ",\"fumee\":";
  body += (fumeeDetectee ? "true" : "false");
  body += ",\"flamme\":";
  body += (flammeDetectee ? "true" : "false");
  body += ",\"incendie\":";
  body += (incendieDetecte ? "true" : "false");
  body += "}";

  bool ok = mqtt.publish(topic_state, body.c_str(), true);

  mqtt.publish(
    topic_presence,
    presenceDetectee ? "1" : "0",
    true
  );

  mqtt.publish(
    topic_incendie,
    incendieDetecte ? "1" : "0",
    true
  );

  Serial.println(ok ? "MQTT state published." : "MQTT publish failed.");
}

// 8. COMMANDES DES LED
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

bool appliquerAuto() {
  if (!modeAuto) return false;

  if (valeurLDR <= seuilSombre) return setAll(true);
  if (valeurLDR >= seuilClair) return setAll(false);

  return false;
}

// 9. RECEPTION MQTT : commandes LED inchangées
void onMessage(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != topic_command ||
      length == 0 || length > 40) return;

  String cmd;

  for (unsigned int i = 0; i < length; i++) {
    cmd += (char)payload[i];
  }

  cmd.trim();
  cmd.toUpperCase();

  Serial.print("Command received: ");
  Serial.println(cmd);

  if (cmd == "MODE:AUTO") {
    modeAuto = true;
    appliquerAuto();
    publishState();
    return;
  }

  if (cmd == "ALL:ON") {
    modeAuto = false;
    setAll(true);
    publishState();
    return;
  }

  if (cmd == "ALL:OFF") {
    modeAuto = false;
    setAll(false);
    publishState();
    return;
  }

  if (cmd.startsWith("LED:")) {
    int sep = cmd.indexOf(':', 4);

    if (sep > 4) {
      int index = cmd.substring(4, sep).toInt();
      String valeur = cmd.substring(sep + 1);

      if (index >= 0 && index < 7 &&
          (valeur == "ON" || valeur == "OFF")) {
        modeAuto = false;
        ledStates[index] = (valeur == "ON");
        digitalWrite(
          ledPins[index],
          ledStates[index] ? HIGH : LOW
        );
        publishState();
      }
    }
  }
}

// 10. LECTURE FILTREE DES CAPTEURS
void lireIncendie() {
  unsigned long maintenant = millis();

  int rawFumee = digitalRead(pinFumee);
  int rawFlamme = digitalRead(pinFlamme);

  if (rawFumee != derniereLectureFumee) {
    derniereLectureFumee = rawFumee;
    changementFumee = maintenant;
  }

  if (rawFlamme != derniereLectureFlamme) {
    derniereLectureFlamme = rawFlamme;
    changementFlamme = maintenant;
  }

  bool changement = false;

  if (maintenant - changementFumee >= filtreCapteur &&
      etatStableFumee != derniereLectureFumee) {
    etatStableFumee = derniereLectureFumee;
    changement = true;
  }

  if (maintenant - changementFlamme >= filtreCapteur &&
      etatStableFlamme != derniereLectureFlamme) {
    etatStableFlamme = derniereLectureFlamme;
    changement = true;
  }

  // D'après le test effectué : LOW signifie détection
  fumeeDetectee = (etatStableFumee == LOW);
  flammeDetectee = (etatStableFlamme == LOW);

  bool nouvelIncendie = fumeeDetectee || flammeDetectee;

  if (nouvelIncendie != incendieDetecte) {
    incendieDetecte = nouvelIncendie;

    // HIGH active le pilote du buzzer.
    // Si ton module pilote fonctionne à l'inverse,
    // il faudra inverser ces deux niveaux.
    digitalWrite(
      pinBuzzer,
      incendieDetecte ? HIGH : LOW
    );

    Serial.println(incendieDetecte
      ? "ALERTE : FUMEE OU FLAMME DETECTEE !"
      : "Alerte incendie terminee.");

    Serial.print("Fumee = ");
    Serial.print(fumeeDetectee ? "OUI" : "NON");
    Serial.print(" | Flamme = ");
    Serial.println(flammeDetectee ? "OUI" : "NON");

    changement = true;
  }

  // Publication uniquement en cas de changement
  if (changement) {
    publishState();
  }
}

// 11. RECONNEXION WI-FI
void gererWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long maintenant = millis();

  if (maintenant - derniereTentativeWiFi >= intervalleWiFi) {
    derniereTentativeWiFi = maintenant;
    Serial.println("WiFi disconnected. Retrying...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }
}

// 12. RECONNEXION MQTT AVEC LWT
void gererMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }

  unsigned long maintenant = millis();

  if (maintenant - derniereTentativeMQTT < intervalleMQTT) return;
  derniereTentativeMQTT = maintenant;

  Serial.print("Connecting to MQTT... ");

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
    mqtt.subscribe(topic_command);
    publishState();
  } else {
    Serial.print("MQTT connection failed, code = ");
    Serial.println(mqtt.state());
  }
}

// 13. INITIALISATION
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

  pinMode(pinFumee, INPUT);
  pinMode(pinFlamme, INPUT);
  pinMode(pinBuzzer, OUTPUT);
  digitalWrite(pinBuzzer, LOW);

  // Initialiser les états des capteurs sans fausse transition
  derniereLectureFumee = digitalRead(pinFumee);
  derniereLectureFlamme = digitalRead(pinFlamme);
  etatStableFumee = derniereLectureFumee;
  etatStableFlamme = derniereLectureFlamme;
  changementFumee = millis();
  changementFlamme = millis();

  fumeeDetectee = (etatStableFumee == LOW);
  flammeDetectee = (etatStableFlamme == LOW);
  incendieDetecte = fumeeDetectee || flammeDetectee;

  digitalWrite(pinBuzzer, incendieDetecte ? HIGH : LOW);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  mqtt.setServer(mqtt_server, mqtt_port);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(2);
  mqtt.setKeepAlive(20);

  Serial.println("MaMaisonIntelligente MQTT + incendie");
  Serial.println("LDR GPIO34 | PIR GPIO27");
  Serial.println("MQ-2 GPIO25 | KY-026 GPIO32");
  Serial.println("Buzzer via pilote GPIO33");

  WiFi.begin(ssid, password);
  derniereTentativeWiFi = millis();

  Serial.print("MQTT broker: ");
  Serial.print(mqtt_server);
  Serial.print(":");
  Serial.println(mqtt_port);
}

// 14. BOUCLE PRINCIPALE
void loop() {
  gererWiFi();
  gererMQTT();

  unsigned long maintenant = millis();

  if (maintenant - derniereLectureLDR >= intervalleLDR) {
    derniereLectureLDR = maintenant;
    valeurLDR = analogRead(ldrPin);

    if (modeAuto && appliquerAuto()) {
      Serial.println("LEDs changed by automatic LDR mode.");
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

  bool mouvement = (digitalRead(pirPin) == HIGH);

  if (mouvement) {
    if (!presenceDetectee) {
      presenceDetectee = true;
      etatLedPresence = true;
      dernierClignotement = maintenant;
      digitalWrite(ledPresencePin, HIGH);
      Serial.println("Motion detected.");
      publishState();
    }

    if (maintenant - dernierClignotement >= intervalleClignotement) {
      dernierClignotement = maintenant;
      etatLedPresence = !etatLedPresence;
      digitalWrite(ledPresencePin, etatLedPresence ? HIGH : LOW);
    }
  } else if (presenceDetectee) {
    presenceDetectee = false;
    etatLedPresence = false;
    digitalWrite(ledPresencePin, LOW);
    Serial.println("No more motion.");
    publishState();
  }

  lireIncendie();

  if (mqtt.connected() &&
      maintenant - dernierEtat >= intervalleEtat) {
    dernierEtat = maintenant;
    publishState();
  }

  delay(2);
}
