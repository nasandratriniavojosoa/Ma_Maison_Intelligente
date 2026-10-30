
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

// ===== BROCHES EXISTANTES =====
#define RFID_SS   5
#define RFID_RST  27
#define SERVO_PIN 13

MFRC522 rfid(RFID_SS, RFID_RST);
Servo porte;

// UID du badge autorise : 11 7D 26 03
byte uidAutorise[] = {0x11, 0x7D, 0x26, 0x03};


// Angles de la porte
const int PORTE_FERMEE = 0;
const int PORTE_OUVERTE = 90;

// Duree avant fermeture automatique
const unsigned long DUREE_OUVERTE = 3000;

bool porteOuverte = false;
unsigned long heureOuverture = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("  MA MAISON INTELLIGENTE");
  Serial.println("  MODULE RFID - ESP32 NUMERO 2");
  Serial.println("================================");

  // Initialisation du lecteur RFID
  Serial.println("[RFID] Initialisation SPI...");
  SPI.begin(18, 19, 23, RFID_SS);
  rfid.PCD_Init();
  delay(100);

  // Verification de la communication avec le RC522
  rfid.PCD_DumpVersionToSerial();

  // Initialisation du servo
  Serial.println("[SERVO] Initialisation...");
  porte.setPeriodHertz(50);
  porte.attach(SERVO_PIN, 500, 2400);
  porte.write(PORTE_FERMEE);
  porteOuverte = false;

  Serial.println("[SERVO] Porte en position fermee.");
  Serial.println("[SYSTEME] Pret !");
  Serial.println("[RFID] Approche une carte...");
}

void loop() {
  // Referme automatiquement la porte apres 3 secondes
  if (porteOuverte &&
      millis() - heureOuverture >= DUREE_OUVERTE) {
    porte.write(PORTE_FERMEE);
    porteOuverte = false;

    Serial.println("[SERVO] Porte refermee automatiquement.");
  }

  // Attend une nouvelle carte
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("[RFID] Erreur de lecture.");
    return;
  }

  // Affiche l'UID et compare le badge
  Serial.println();
  Serial.println("[RFID] Carte detectee !");

  Serial.print("[RFID] UID : ");

  bool autorise = (rfid.uid.size == sizeof(uidAutorise));

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print("0");
    }

    Serial.print(rfid.uid.uidByte[i], HEX);
    Serial.print(" ");

    if (autorise &&
        rfid.uid.uidByte[i] != uidAutorise[i]) {
      autorise = false;
    }
  }

  Serial.println();

  if (autorise) {
    Serial.println("[ACCES] AUTORISE !");
    Serial.println("[SERVO] Ouverture de la porte...");

    porte.write(PORTE_OUVERTE);
    porteOuverte = true;
    heureOuverture = millis();

    Serial.println("[SERVO] Porte ouverte.");
    Serial.println("[INFO] Fermeture dans 3 secondes.");
  } else {
    Serial.println("[ACCES] REFUSE !");
    Serial.println("[INFO] Badge non autorise.");
  }

  // Termine proprement la lecture RFID
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  Serial.println("[SYSTEME] En attente d'une autre carte...");
  delay(500);
}
    
