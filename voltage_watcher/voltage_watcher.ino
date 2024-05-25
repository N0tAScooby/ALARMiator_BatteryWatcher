#include <ArduinoJson.h>
#include <ArduinoJson.hpp>
#include <EEPROM.h>
#include <StreamUtils.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
//#include <WiFiClientSecureBearSSL.h>
#include <WiFiClient.h>
#include <ESP8266httpUpdate.h>


const String versionNumber = "1.0.0";  // needs to be incremented for OTA update

StaticJsonDocument<512> doc;

const char* ssid = "";
const char* password = "";

String serverIP = "";  // no slash at the end
int serverPort = 5056;
String configURL = "/batterywatcher/config/:id/:softwareVersion";  // id / softwareVersion
String updateURL = "/batterywatcher/update/:id/firmware.bin";      //id
String voltageUpdateURL = "/batterywatcher/:id";                   // voltage

const int analogInPin = A0;  // ESP8266 Analog Pin ADC0 = A0

const double AdcStepToVoltageFactor = 0.00322580645;  // 3.3V / 1023 Steps = this value which is used to convert between the adc reading and actual voltages

const int VoltageDividerFactor = 5;  // the voltage sensor divides a given voltage by 5

String UniqueId;

double avgVoltage;

String ipAddr;

bool updateNeeded;
bool updatedFirmware = false;

int piepPin = 5;

WiFiClient client;
HTTPClient http;


void connectToWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.println("Connecting");
  unsigned long startAttemptTime = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");

    if ((millis() - startAttemptTime) > 30000000) {
      Serial.println("Wifi Timeout");
      sleepyTime(ESP.deepSleepMax());
    }
  }
  ipAddr = WiFi.localIP().toString();
  Serial.println("");
  Serial.print("Connected to WiFi network with IP Address: ");
  Serial.println(ipAddr);
}


String serializeJSON(float voltage) {
  JsonDocument doc;

  String JSON = "";

  doc["voltage"] = voltage;
  serializeJson(doc, JSON);

  return JSON;
}

//String makeSSLGetRequest(String URL) {
//  if ((WiFi.status() == WL_CONNECTED)) {
//
//    std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
//
//    // Ignore SSL certificate validation
//    client->setInsecure();
//
//    //create an HTTPClient instance
//    HTTPClient https;
//
//    //Initializing an HTTPS communication using the secure client
//    Serial.print("[HTTPS] begin...\n");
//    if (https.begin(*client, URL)) {  // HTTPS
//      Serial.print("[HTTPS] GET...\n");
//      // start connection and send HTTP header
//      int httpCode = https.GET();
//      // httpCode will be negative on error
//      if (httpCode > 0) {
//        // HTTP header has been send and Server response header has been handled
//        Serial.printf("[HTTPS] GET... code: %d\n", httpCode);
//        // file found at server
//        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
//          String payload = https.getString();
//          Serial.println(payload);
//
//          return payload;
//        }
//      } else {
//        Serial.printf("[HTTPS] GET... failed, error: %s\n", https.errorToString(httpCode).c_str());
//      }
//
//      https.end();
//    }
//  } else {
//    Serial.printf("[HTTPS] Unable to connect\n");
//  }
//  return "";  // no answer
//}

//String makeSSLPostRequest(String URL, String payload) {
//  if ((WiFi.status() == WL_CONNECTED)) {
//
//    std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
//
//    // Ignore SSL certificate validation
//    client->setInsecure();
//
//    //create an HTTPClient instance
//    HTTPClient https;
//
//    //Initializing an HTTPS communication using the secure client
//    Serial.print("[HTTPS] begin...\n");
//    if (https.begin(*client, URL)) {  // HTTPS
//      Serial.print("[HTTPS] POST...\n");
//      // start connection and send HTTP header
//      int httpCode = https.POST(payload);
//      // httpCode will be negative on error
//      if (httpCode > 0) {
//        // HTTP header has been send and Server response header has been handled
//        Serial.printf("[HTTPS] POST... code: %d\n", httpCode);
//        // file found at server
//        if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
//          String payload = https.getString();
//          Serial.println(payload);
//
//          return payload;
//        }
//      } else {
//        Serial.printf("[HTTPS] POST... failed, error: %s\n", https.errorToString(httpCode).c_str());
//      }
//
//      https.end();
//    }
//  } else {
//    Serial.printf("[HTTPS] Unable to connect\n");
//  }
//  return "";  // no answer
//}

String makeHTTPGetRequest(String serverIP, int serverPort, String path) {
  if (WiFi.status() == WL_CONNECTED) {
    String url = "http://" + serverIP + ":" + String(serverPort) + path;
    Serial.println("Calling URL: " + url);

    http.begin(client, url);
    int httpResponseCode = http.GET();
    String payload = "";

    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      payload = http.getString();
    } else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
    return payload;
  } else {
    Serial.println("WiFi Disconnected");
    return "";
  }
}

String makeHTTPPostRequest(String serverIP, int serverPort, String path, String payload) {
  if (WiFi.status() == WL_CONNECTED) {
    String url = "http://" + serverIP + ":" + String(serverPort) + path;
    Serial.println("Calling URL: " + url);

    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.POST(payload);
    String response = "";

    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      response = http.getString();
    } else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
    return response;
  } else {
    Serial.println("WiFi Disconnected");
    return "";
  }
}


void sleepyTime(int sleep) {
  Serial.println("Sleeping now");
  ESP.deepSleep(sleep);
}

float measureVoltage(float MeasureErrorOffset, int readingsNum, int readingsDelay) {
  int sensorValue = 0;
  double sum = 0;
  float readings[readingsNum];

  for (int i = 0; i < readingsNum; i++) {
    sensorValue = analogRead(A0);
    readings[i] = sensorValue;
    Serial.print("Reading: ");
    Serial.println(readings[i], 3);

    delay(readingsDelay);
  }

  // Sort readings to drop the highest and lowest values
  for (int i = 0; i < readingsNum - 1; i++) {
    for (int j = 0; j < readingsNum - i - 1; j++) {
      if (readings[j] > readings[j + 1]) {
        float temp = readings[j];
        readings[j] = readings[j + 1];
        readings[j + 1] = temp;
      }
    }
  }

  // Calculate sum excluding the highest and lowest values
  for (int i = 1; i < readingsNum - 1; i++) {
    sum += readings[i];
  }

  // Calculate average of remaining readings
  avgVoltage = sum / (readingsNum - 2);
  avgVoltage = ((avgVoltage * AdcStepToVoltageFactor) * VoltageDividerFactor) - MeasureErrorOffset;
  Serial.print("Average Voltage: ");
  Serial.println(avgVoltage, 3);

  return avgVoltage;
}


void writeConfigToEEPROM() {
  EepromStream eepromStream(0, EEPROM.length());
  serializeJson(doc, eepromStream);
  eepromStream.flush();  // commit the data
}

void soundAlarm() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(piepPin, HIGH);
    delay(1000);
    digitalWrite(piepPin, LOW);
    delay(1000);
  }

  Serial.println("Alarm sounded going to sleep now");


  //sleepyTime(20e6);  // 20 seconds of sleeping then we piep again
}

void setup() {
  Serial.begin(74880);
  Serial.println("");
  pinMode(piepPin, OUTPUT);

  // output unique esp2866 chip id
  Serial.println("Id");

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  Serial.println(mac);
  UniqueId = mac;

  Serial.print("--------------Running software version: ");
  Serial.print(versionNumber);
  Serial.println("------------------");

  // attempt to read the config from EEPROM emulated space
  EEPROM.begin(512);
  EepromStream eepromStream(0, EEPROM.length());
  deserializeJson(doc, eepromStream);  // stores it in global config JSON

  // get from json or set default values
  float measurementOffset = doc["measurement_offset"] | 1.1;
  float alarmThreshold = doc["alarm_threshhold"] | 11.2;
  int readingsAmount = doc["readingsAmount"] | 5;
  int readingsDelay = doc["readingsDelay"] | 200;

  Serial.println(measurementOffset);
  Serial.println(alarmThreshold);
  Serial.println(readingsAmount);
  Serial.println(readingsDelay);

  Serial.println("Current alarm threshhold: ");
  Serial.println(alarmThreshold);


  connectToWifi();



  avgVoltage = measureVoltage(measurementOffset, readingsAmount, readingsDelay);
  voltageUpdateURL.replace(":id", UniqueId);
  char json[64];
  sprintf(json, "{\"voltage\": %.3f}", avgVoltage);
    makeHTTPPostRequest(serverIP, serverPort, voltageUpdateURL, String(json));


  if (avgVoltage <= alarmThreshold) {
    Serial.println("Voltage is under the threshhold!!! Sounding alarm");
    // transmit the low voltage to server
    //sound alarm
    soundAlarm();
  }

  configURL.replace(":id", UniqueId);
  configURL.replace(":softwareVersion", versionNumber);
  String Response = makeHTTPGetRequest(serverIP, serverPort, configURL);

  // Deserialize the JSON response
  DeserializationError error = deserializeJson(doc, Response);
  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
  }

  updateNeeded = doc["updateNeeded"] | false;  // this will either fail if the request doesnt go through and produce false or it will succeed and then the stored flash config doesnt matter

  //Write to EEPROM
  float measurementOffsetNew = doc["measurement_offset"] | measurementOffset;
  float alarmThresholdNew = doc["alarm_threshhold"] | alarmThreshold;
  int readingsAmountNew = doc["readingsAmount"] | readingsAmount;
  int readingsDelayNew = doc["readingsDelay"] | readingsDelay;

  if ((measurementOffset != measurementOffsetNew) || (alarmThreshold != alarmThresholdNew) || (readingsAmount != readingsAmountNew) || (readingsDelay != readingsDelayNew)) {
    Serial.println(measurementOffsetNew);
    Serial.println(alarmThresholdNew);
    Serial.println(readingsAmountNew);
    Serial.println(readingsDelayNew);
    Serial.println(measurementOffset != measurementOffsetNew);
    Serial.println(alarmThreshold != alarmThresholdNew);
    Serial.println(readingsAmount != readingsAmountNew);
    Serial.println(readingsDelay != readingsDelayNew);
    Serial.println("Writing to EEPROM now cause config differs");
    writeConfigToEEPROM();
  } else {
    Serial.println("Config not changed no need to update EEPROM flash");
  }


  if (updateNeeded) {
    Serial.println("Update needed");
    // request update from Server
    updateURL.replace(":id", UniqueId);
    ESPhttpUpdate.update(client, serverIP, serverPort, updateURL);
  }

  //sleepyTime(ESP.deepSleepMax());
  sleepyTime(15e7);
}

void loop() {
}