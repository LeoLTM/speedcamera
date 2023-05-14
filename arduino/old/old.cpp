#include <Arduino.h>

const int sensor1 = 16;
const int sensor2 = 12;


/*
int sensor1Value = 0;
int sensor2Value = 0;
*/

const int debounceTime = 50;            //milliseconds
const float sensorDistance = 160.0f;       //millimeters
const float maxSpeedKmH = 0;           //km/h
const long measuringInterval = 2500;    //milliseconds
const int flashTime = 100;              //milliseconds
      long timer1 = 0;
      long timer2 = 0;
      float passing_time = 0.0f;
      float speedInKmH = 0;
      long wait = 0;
      bool hasFlashed = false;


void setup() {
  // put your setup code here, to run once:
  
  Serial.begin(115200);
  pinMode(sensor1, INPUT_PULLUP);
  pinMode(sensor2, INPUT_PULLUP);
  Serial.println("Setup done.");


/*  pinMode(flashPin, OUTPUT);
  pinMode(sensor1, INPUT);
  pinMode(sensor2, INPUT);
  */
  
}

void loop() {
  // put your main code here, to run repeatedly:

  // Debug code
  /*
  sensor1Value = digitalRead(sensor1);
  sensor2Value = digitalRead(sensor2);
  Serial.print(sensor1Value);
  Serial.print("    ");
  Serial.print(sensor2Value);
  Serial.println("");
  delay(50);
  */


  if(digitalRead(sensor1) == HIGH && digitalRead(sensor2) == LOW) {
    // Start timer1
    timer1 = millis();
    Serial.println("Messung gestartet!");
    //wait = millis() + debounceTime;
    // && (millis() > wait) aus bedingung
  
    // For xxx milliseconds, check
    while((measuringInterval > millis()-timer1) && (!hasFlashed)) {
      Serial.println("Messung lÃ¤uft...");
      wait = 0;
      // If sensor2 gets triggered
      if(digitalRead(sensor2) == HIGH ) {
        timer2 = millis();
        // If the speed is greater than the max speed
        //wait = millis() + debounceTime;
        // && (millis() > wait) aus bedingung
        Serial.println("Messung abgeschlossen!");
        

        passing_time = timer2 - timer1; //time in milliseconds
        Serial.print("Passing time: ");
        Serial.println(passing_time);
        Serial.print("Geschwindigkeit: ");
        speedInKmH = ( (sensorDistance / passing_time)*3.6f);
        Serial.println(speedInKmH);

        if(speedInKmH > maxSpeedKmH){
          // Flash the LEDs
          Serial.println("BLITZ!");
          hasFlashed = true;
        }
        break;
      }
    }
    hasFlashed = false;
    delay(500);
  }
}

// LOl
/*
bool checkSensor1() {
long timer = millis();
while(digitalRead(sensor1) == HIGH && millis()-timer < debounceTime) {
  if(digitalRead(sensor1) == HIGH) {
    return true;
  }
} 
*/