
#include <Servo.h>

// ===== SUIVEUR SOLAIRE =====
#define LDR1 A0
#define LDR2 A1

Servo servoSolaire;
int angle = 90;
int erreur = 30;
int pas = 5;

// ===== SYSTÈME DE PLUIE =====
#define CAPTEUR_PLUIE 2
#define SERVO_PLUIE 3

Servo servoPluie;

// Gestion du temps
unsigned long tempsSolaire = 0;
unsigned long tempsPluie = 0;

void setup() {
  Serial.begin(9600);

  // Initialiser le servo solaire
  servoSolaire.attach(9);
  servoSolaire.write(angle);

  // Initialiser le capteur et le servo de pluie
  pinMode(CAPTEUR_PLUIE, INPUT);
  servoPluie.attach(SERVO_PLUIE);
  servoPluie.write(0);

  Serial.println("Systeme solaire et pluie demarre");
}

void loop() {
  unsigned long maintenant = millis();

  // ===== SUIVI SOLAIRE : toutes les 30 ms =====
  if (maintenant - tempsSolaire >= 30) {
    tempsSolaire = maintenant;

    int lumiere1 = analogRead(LDR1);
    int lumiere2 = analogRead(LDR2);

    Serial.print("LDR gauche : ");
    Serial.print(lumiere1);
    Serial.print(" | LDR droite : ");
    Serial.println(lumiere2);

    if (abs(lumiere1 - lumiere2) > erreur) {
      if (lumiere1 > lumiere2) {
        angle -= pas;
      } else {
        angle += pas;
      }

      angle = constrain(angle, 0, 180);
      servoSolaire.write(angle);

      Serial.print("Angle solaire : ");
      Serial.println(angle);
    }
  }

  // ===== CAPTEUR DE PLUIE : toutes les 1000 ms =====
  if (maintenant - tempsPluie >= 1000) {
    tempsPluie = maintenant;

    int pluie = digitalRead(CAPTEUR_PLUIE);

    Serial.print("Etat pluie : ");
    Serial.println(pluie);

    if (pluie == LOW) {
      servoPluie.write(90);
      Serial.println("Pluie detectee ! Fermeture...");
    } else {
      servoPluie.write(0);
      Serial.println("Pas de pluie. Ouverture...");
    }
  }
}

