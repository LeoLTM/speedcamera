#include <Arduino.h>

const int sensor1 = 16; //GPIO 16, D0
const int sensor2 = 12; //GPIO 12, D6
const int flashPin = 13; //GPIO 13, D7


/*
int sensor1Value = 0;
int sensor2Value = 0;
*/

const int debounceTime = 50;            //milliseconds
const float sensorDistance = 160.0f;       //millimeters
const float maxSpeedKmH = 2;           //km/h
const long measuringInterval = 2500;    //milliseconds
const int flashTime = 200;              //milliseconds
      long timer1 = 0;
      long timer2 = 0;
      float passing_time = 0.0f;
      float speedInKmH = 0;
      long wait = 0;
      bool hasFlashed = false;


void setup() {
  // put your setup code here, to run once:
  
  Serial.begin(115200);
  Serial.setTimeout(10);
  pinMode(sensor1, INPUT_PULLUP);
  pinMode(sensor2, INPUT_PULLUP);
  pinMode(flashPin, OUTPUT);
  // Serial.println("Setup done.");


/*  pinMode(flashPin, OUTPUT);
  pinMode(sensor1, INPUT);
  pinMode(sensor2, INPUT);
  */
  
}

void loop() {
  // put your main code here, to run repeatedly:

if(Serial.readString() == "5") {
            digitalWrite(flashPin, HIGH);
            delay(flashTime);
            digitalWrite(flashPin, LOW);
          }


  if(digitalRead(sensor1) == HIGH && digitalRead(sensor2) == LOW) {
    // Start timer1
    timer1 = millis();

    // Serial.println("Messung gestartet!");
    // Send 1 to indicate start of measurement
    Serial.println("1");
  
    // For xxx milliseconds, check
    while((measuringInterval > millis()-timer1) && (!hasFlashed)) {
      // Serial.println("Messung läuft...");
      // If sensor2 gets triggered
      if(digitalRead(sensor2) == HIGH ) {
        timer2 = millis();
        // Serial.println("Messung abgeschlossen!");

        passing_time = timer2 - timer1; //time in milliseconds
        // Serial.print("Passing time: ");
        // Serial.println(passing_time);
        // Serial.print("Geschwindigkeit: ");
        speedInKmH = ( (sensorDistance / passing_time)*3.6f);
        // Serial.println(speedInKmH);

        // If speed is higher than maxSpeedKmH
        if(speedInKmH > maxSpeedKmH){
          // Flash the LEDs
          // Serial.println("BLITZ!");
          hasFlashed = true;
          // Send 3 to indicate flash
          Serial.println("3");

          while(Serial.available() == 0) {
            // Wait for serial input
          }
          if(Serial.readString() == "5") {
            digitalWrite(flashPin, HIGH);
            delay(flashTime);
            digitalWrite(flashPin, LOW);
          }
        } else{
          // Send 2 to indicate no flash
          Serial.println("2");
        }
        break;
      }
    }
    // Send 0 to indicate idle state
    Serial.println("0");
    hasFlashed = false;

  }
  }





  /// DSJKABFKHAWBFQABWLFbqwlhkf