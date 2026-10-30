
#include <DHT.h>

// ===== DHT22 ET RELAIS =====
#define DHTPIN 2
#define DHTTYPE DHT22
#define RELAIS 8

DHT dht(DHTPIN, DHTTYPE);

float temperature = 0;
unsigned long dernierTempsDHT = 0;

// ===== ASCENSEUR ET ULTRASON =====
const int TRIG = 11;
const int ECHO = 12;

const int BOUTON_BASE = 10;
const int BOUTON_ETAGE1 = 3;
const int BOUTON_ETAGE2 = 4;

const int ENA = 5;
const int IN1 = 6;
const int IN2 = 7;

float distance;
float cible;

bool deplacement = false;

// ===== INITIALISATION =====
void setup() {
  Serial.begin(9600);

  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pinMode(BOUTON_BASE, INPUT_PULLUP);
  pinMode(BOUTON_ETAGE1, INPUT_PULLUP);
  pinMode(BOUTON_ETAGE2, INPUT_PULLUP);

  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  pinMode(RELAIS, OUTPUT);
  digitalWrite(RELAIS, HIGH);

  dht.begin();
  arreter();

  Serial.println("Ascenseur et DHT22 prets !");
}

// ===== BOUCLE PRINCIPALE =====
void loop() {
  gererTemperature();

  if (!deplacement) {
    if (digitalRead(BOUTON_BASE) == LOW) {
      cible = 44;
      deplacement = true;
    }
    else if (digitalRead(BOUTON_ETAGE1) == LOW) {
      cible = 24;
      deplacement = true;
    }
    else if (digitalRead(BOUTON_ETAGE2) == LOW) {
      cible = 4;
      deplacement = true;
    }
  }

  if (deplacement) {
    mesurerEtDeplacer();
  }
}

// ===== SURVEILLANCE TEMPERATURE =====
void gererTemperature() {
  if (millis() - dernierTempsDHT >= 2000) {
    dernierTempsDHT = millis();

    float t = dht.readTemperature();

    if (isnan(t)) {
      Serial.println("Erreur de lecture DHT22 !");
      return;
    }

    temperature = t;

    Serial.print("Temperature : ");
    Serial.print(temperature);
    Serial.println(" °C");

    if (temperature > 40) {
      digitalWrite(RELAIS, LOW);
      Serial.println("-> Relais DESACTIVE");
    }
    else if (temperature <= 39) {
      digitalWrite(RELAIS, HIGH);
      Serial.println("-> Relais ACTIVE");
    }

    Serial.println("---------------------------");
  }
}

// ===== MESURE ET DEPLACEMENT =====
void mesurerEtDeplacer() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  unsigned long duree = pulseIn(ECHO, HIGH, 30000);

  if (duree == 0) {
    arreter();
    deplacement = false;
    Serial.println("Erreur : pas d'echo !");
    return;
  }

  distance = duree * 0.0343 / 2.0;

  Serial.print("Distance : ");
  Serial.print(distance);
  Serial.println(" cm");

  if (distance < 1 || distance > 350) {
    arreter();
    deplacement = false;
    Serial.println("Distance invalide !");
    return;
  }

  if (abs(distance - cible) <= 1.5) {
    arreter();
    deplacement = false;
    Serial.println("Etage atteint !");
    return;
  }
    
  if (distance > cible) {
    monter();
  } else {
    descendre();
  }

  delay(50);
}

// ===== COMMANDES MOTEUR =====
void monter() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  analogWrite(ENA, 77);
}
 
void descendre() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  analogWrite(ENA, 70);
}

void arreter() {
  analogWrite(ENA, 0);
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
}

