/*
 * ======================================================================================
 * ESP32 Bioprocess Telemetry Transmitter with Direct Supabase REST Integration
 * AICTE IDEA Lab 1st Semester Student Project
 * ======================================================================================
 * 
 * Sensors:
 *   1. Turbidity Sensor (Analog Pin 34)
 *   2. DS18B20 Temperature Sensor (OneWire Pin 4)
 *   3. Analog pH Sensor (Analog Pin 35)
 *   4. Headspace Gas Sensor (MQ-135 / MQ Series on Analog Pin 32 - CO2/VOC ppm)
 * 
 * Connectivity:
 *   - Wi-Fi (Router or Phone Hotspot)
 *   - HTTPS POST directly to Supabase REST endpoint: /rest/v1/bioprocess_readings
 * ======================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// -------------------------------------------------------------
// 1. Wi-Fi Configuration (Phone Hotspot or Lab Router)
// -------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_OR_HOTSPOT_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// -------------------------------------------------------------
// 2. Supabase Configuration
// -------------------------------------------------------------
// Format: https://<project-ref>.supabase.co/rest/v1/bioprocess_readings
const char* SUPABASE_REST_URL = "https://YOUR_PROJECT_ID.supabase.co/rest/v1/bioprocess_readings";
const char* SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

// -------------------------------------------------------------
// 3. Hardware Pin Definitions
// -------------------------------------------------------------
#define TURBIDITY_PIN  34    // ESP32 ADC1 Pin (Analog input)
#define PH_PIN         35    // ESP32 ADC1 Pin (Analog input)
#define GAS_PIN        32    // ESP32 ADC1 Pin (MQ-135 / MQ-3 / MQ-2 Gas sensor)
#define ONE_WIRE_BUS   4     // DS18B20 Data Pin (4.7k pull-up resistor to 3.3V)

// Temperature Sensor Setup
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

// Sampling timing
const unsigned long TRANSMIT_INTERVAL_MS = 10000; // Send reading every 10 seconds
unsigned long lastTransmitTime = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Initializing ESP32 Bioprocess Logger ---");

  // Initialize DS18B20
  sensors.begin();

  // Initialize Wi-Fi
  connectToWiFi();
}

void loop() {
  // Check Wi-Fi reconnection if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  // Interval check
  if (millis() - lastTransmitTime >= TRANSMIT_INTERVAL_MS) {
    lastTransmitTime = millis();
    readSensorsAndTransmit();
  }
}

void connectToWiFi() {
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Failed to connect. Will retry in loop.");
  }
}

void readSensorsAndTransmit() {
  // -----------------------------------------------------------
  // 1. Read Temperature (°C)
  // -----------------------------------------------------------
  sensors.requestTemperatures();
  float temperature = sensors.getTempCByIndex(0);
  if (temperature == DEVICE_DISCONNECTED_C) {
    temperature = 30.0; // Fallback default if sensor disconnected
  }

  // -----------------------------------------------------------
  // 2. Read Turbidity (NTU)
  // -----------------------------------------------------------
  int rawTurbidity = analogRead(TURBIDITY_PIN);
  float voltageTurbidity = (rawTurbidity / 4095.0) * 3.3;
  // Polynomial calibration curve (typical for DF-Robot / generic optical turbidity module)
  // NTU increases as solution becomes cloudier / more cells
  float turbidity = (-1120.4 * voltageTurbidity * voltageTurbidity) + (5742.3 * voltageTurbidity) - 4352.9;
  if (turbidity < 0.0) turbidity = 0.0;
  // If sensor is in clear broth baseline is ~100 NTU; max yeast density reaches ~800 NTU

  // -----------------------------------------------------------
  // 3. Read pH Value
  // -----------------------------------------------------------
  int rawPH = analogRead(PH_PIN);
  float voltagePH = (rawPH / 4095.0) * 3.3;
  // Standard analog pH probe linear calibration: pH = 7.0 + ((2.5 - V) / 0.18)
  float ph = 7.0 + ((1.65 - voltagePH) * 3.5);
  if (ph < 0.0) ph = 0.0;
  if (ph > 14.0) ph = 14.0;

  // -----------------------------------------------------------
  // 4. Read Headspace Gas Sensor (MQ-135 / CO2 / VOC)
  // -----------------------------------------------------------
  int rawGas = analogRead(GAS_PIN);
  float voltageGas = (rawGas / 4095.0) * 3.3;
  // Approximation curve for MQ gas sensor (PPM of CO2/fermentation off-gas)
  // Baseline ambient is ~400 PPM; increases up to 3500+ PPM during active metabolism
  float gas = 400.0 + (voltageGas * 950.0);
  if (gas < 400.0) gas = 400.0;

  Serial.println("=========================================");
  Serial.printf("Turbidity: %.1f NTU | Temp: %.1f °C | pH: %.2f | Gas: %.0f PPM\n", turbidity, temperature, ph, gas);

  // -----------------------------------------------------------
  // 5. Send HTTP POST to Supabase REST API
  // -----------------------------------------------------------
  WiFiClientSecure client;
  client.setInsecure(); // Skip SSL certificate verification for simplicity on ESP32

  HTTPClient http;
  if (http.begin(client, SUPABASE_REST_URL)) {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("Prefer", "return=minimal");

    // Construct JSON payload
    String jsonPayload = "{";
    jsonPayload += "\"turbidity\":" + String(turbidity, 1) + ",";
    jsonPayload += "\"temperature\":" + String(temperature, 1) + ",";
    jsonPayload += "\"ph\":" + String(ph, 2) + ",";
    jsonPayload += "\"gas\":" + String(gas, 1) + ",";
    jsonPayload += "\"device_id\":\"ESP32_LAB_01\"";
    jsonPayload += "}";

    int httpCode = http.POST(jsonPayload);
    Serial.printf("[Supabase] HTTP Response Code: %d\n", httpCode);

    if (httpCode > 0) {
      if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
        Serial.println("[Supabase] Successfully posted sensor readings to cloud!");
      }
    } else {
      Serial.printf("[Supabase] POST error: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("[Supabase] Unable to connect to HTTP client.");
  }
}

