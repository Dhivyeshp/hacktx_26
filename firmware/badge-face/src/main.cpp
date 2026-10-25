// Animated robot face for the Hack the North 2026 badge.
//
// The Pi forwards relay commands as one JSON object per line over USB serial
// (relay/clients/pi/pi_client.py). This firmware handles the `screen` ones:
//
//   {"type":"screen","face":"happy","text":"Maya, you're up!"}
//   {"type":"screen","qr":"https://example.com/join","text":"Scan to join"}
//   {"type":"screen","qr":false}
//
// Every field is optional and a missing field keeps its current value.
// "text":"" clears the caption. "qr" swaps the face for a QR code of that URL;
// "qr":true re-shows the last URL and "qr":false (or "") goes back to the face.
// Other command types are ignored. A plain (non-JSON) line is shown as the
// caption, handy for testing from a terminal. Each handled command is acked
// with {"screen_face":...,"screen_text":...,"screen_qr":...}.
// The Start button cycles through the faces. The A button shows the join QR
// code (kJoinUrl) for 15 seconds.
//
// NFC: {"type":"nfc_read"} and {"type":"nfc_write","url":...}, see handleNfc().

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <vector>

#include "nfc.h"

// Pin map from hackthenorth/badge-firmware docs/CUSTOM-FIRMWARE-HAL.md.
static constexpr int PIN_LCD_MOSI = 10;
static constexpr int PIN_LCD_CLK = 1;
static constexpr int PIN_LCD_CS = 2;
static constexpr int PIN_LCD_DC = 0;
static constexpr int PIN_LCD_RST = 4;
static constexpr int PIN_BTN_START = 9;
// A, B, Home, Down, Left, Right, Up and Aux1 sit on a 74HC165, A shifted out first.
static constexpr int PIN_HC165_DATA = 7;
static constexpr int PIN_HC165_LOAD = 20;
static constexpr int PIN_HC165_CLK = 21;

static const char* const kJoinUrl = "https://zoning-tacky-mastiff.ngrok-free.dev/join/0AEDDD";
static constexpr uint32_t kJoinQrMs = 15000;

class BadgeLcd : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789 panel_;
  lgfx::Bus_SPI bus_;

 public:
  BadgeLcd() {
    auto bus = bus_.config();
    bus.spi_host = SPI2_HOST;
    bus.spi_mode = 0;
    bus.freq_write = 40000000;
    bus.spi_3wire = true;
    bus.dma_channel = SPI_DMA_CH_AUTO;
    bus.pin_sclk = PIN_LCD_CLK;
    bus.pin_mosi = PIN_LCD_MOSI;
    bus.pin_miso = -1;
    bus.pin_dc = PIN_LCD_DC;
    bus_.config(bus);
    panel_.setBus(&bus_);

    auto cfg = panel_.config();
    cfg.pin_cs = PIN_LCD_CS;
    cfg.pin_rst = PIN_LCD_RST;
    cfg.pin_busy = -1;
    cfg.panel_width = 240;
    cfg.panel_height = 320;
    cfg.readable = false;
    cfg.invert = true;
    cfg.rgb_order = false;
    panel_.config(cfg);
    setPanel(&panel_);
  }
};

static BadgeLcd lcd;
static LGFX_Sprite canvas(&lcd);

static constexpr int W = 320;
static constexpr int H = 240;

static const uint16_t kPaper = lgfx::color565(255, 255, 255);
static const uint16_t kInk = lgfx::color565(0, 0, 0);
static const uint16_t kBlush = lgfx::color565(255, 175, 195);
static const uint16_t kHeart = lgfx::color565(255, 85, 125);

// Every field is a float so two faces can be blended field by field.
struct Face {
  float eyeW, eyeH, eyeR;  // eye size and corner radius, px
  float lidSlope;          // + angry (inner corners down), - sad (outer corners down)
  float lidTop;            // 0..1 of each eye hidden from the top (sleepy)
  float happy;             // 0..1 of each eye cut from below (^ ^ eyes)
  float winkR;             // 0..1 right eye closed
  float heart;             // > 0.5 draws hearts instead of eyes
  float lookX, lookY;      // -1..1 resting gaze
  float mouthW, mouthCurve, mouthOpen, cat;  // cat > 0.5 draws a "w" mouth
  float blush;             // 0..1
};
static constexpr int kFaceFields = sizeof(Face) / sizeof(float);

struct NamedFace {
  const char* name;
  Face face;
};

// clang-format off
static const NamedFace kFaces[] = {
  //            eyeW eyeH eyeR  slope  lidTop happy wink heart lookX lookY  mW  curve open  cat blush
  {"neutral",  { 60,  84,  30,   0.0f, 0.0f,  0.0f, 0,   0,     0,    0,   40, 0.4f, 0.0f, 0,  0.3f}},
  {"happy",    { 62,  80,  31,   0.0f, 0.0f,  0.45f,0,   0,     0,    0,   60, 1.0f, 0.0f, 0,  0.8f}},
  {"excited",  { 68,  94,  34,   0.0f, 0.0f,  0.4f, 0,   0,     0,    0,   60, 1.0f, 0.8f, 0,  1.0f}},
  {"cute",     { 62,  80,  31,   0.0f, 0.0f,  0.45f,0,   0,     0,    0,   40, 0.0f, 0.0f, 1,  1.0f}},
  {"love",     { 60,  84,  30,   0.0f, 0.0f,  0.0f, 0,   1,     0,    0,   50, 1.0f, 0.0f, 0,  1.0f}},
  {"wink",     { 60,  84,  30,   0.0f, 0.0f,  0.2f, 1,   0,     0,    0,   56, 1.0f, 0.0f, 0,  0.6f}},
  {"surprised",{ 70,  98,  35,   0.0f, 0.0f,  0.0f, 0,   0,     0,    0,   28, 0.0f, 0.7f, 0,  0.2f}},
  {"thinking", { 58,  80,  29,  -0.1f, 0.15f, 0.0f, 0,   0,  -0.8f,-0.8f,  28, 0.0f, 0.0f, 0,  0.0f}},
  {"sad",      { 60,  76,  30, -0.35f, 0.0f,  0.0f, 0,   0,     0, 0.5f,   40,-0.8f, 0.0f, 0,  0.0f}},
  {"angry",    { 62,  74,  24,  0.45f, 0.0f,  0.0f, 0,   0,     0,    0,   46,-0.6f, 0.0f, 0,  0.0f}},
  {"sleepy",   { 60,  84,  30,   0.0f, 0.75f, 0.0f, 0,   0,     0, 0.3f,   26, 0.1f, 0.0f, 0,  0.3f}},
};
// clang-format on
static constexpr int kFaceCount = sizeof(kFaces) / sizeof(kFaces[0]);
static constexpr int NEUTRAL = 0, HAPPY = 1, SURPRISED = 6;

static int faceIndex = NEUTRAL;
static Face cur = kFaces[NEUTRAL].face;
static String caption;
static std::vector<String> captionLines;
static const lgfx::GFXfont* captionFont = &fonts::FreeSansBold12pt7b;
static float layoutY = 98;  // eye line, eased between captioned and bare layouts

static String qrUrl;
static bool qrShown = false;
static bool qrDirty = false;  // the QR screen is static, so it is only redrawn on change
static uint32_t qrHideAt = 0;  // when the A button's QR goes away; 0 = stays until told

// Idle animation state.
static uint32_t blinkStart = 0, nextBlink = 1500;
static bool doubleBlink = false;
static uint32_t nextGlance = 1000;
static float glanceX = 0, glanceY = 0, gazeX = 0, gazeY = 0;
static uint32_t reactAt = 0;            // last expression change, drives the bounce
static uint32_t lastCommandAt = 0;
static int fidgetFace = -1;             // brief expression while idling in neutral
static uint32_t fidgetUntil = 0, nextFidget = 8000;

static uint32_t randBetween(uint32_t lo, uint32_t hi) { return lo + esp_random() % (hi - lo); }
static float randSigned() { return (int32_t)(esp_random() % 2001) / 1000.0f - 1.0f; }

static int findFace(const char* name) {
  for (int i = 0; i < kFaceCount; i++) {
    if (strcasecmp(kFaces[i].name, name) == 0) return i;
  }
  return -1;
}

static void setFace(int index) {
  fidgetFace = -1;
  if (index == faceIndex) return;
  faceIndex = index;
  blinkStart = reactAt = millis();  // blink and bounce into the new expression
}

static std::vector<String> wrapText(const String& text, const lgfx::GFXfont* font, int maxW) {
  canvas.setFont(font);
  std::vector<String> lines;
  String line;
  int start = 0;
  while (start <= (int)text.length()) {
    int end = text.indexOf(' ', start);
    if (end < 0) end = text.length();
    String word = text.substring(start, end);
    start = end + 1;
    if (word.isEmpty()) continue;
    String candidate = line.isEmpty() ? word : line + " " + word;
    if (!line.isEmpty() && canvas.textWidth(candidate) > maxW) {
      lines.push_back(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (!line.isEmpty()) lines.push_back(line);
  return lines;
}

static void setCaption(const String& text) {
  caption = text;
  caption.trim();
  captionFont = &fonts::FreeSansBold12pt7b;
  captionLines = wrapText(caption, captionFont, W - 20);
  if (captionLines.size() > 2) {
    captionFont = &fonts::FreeSans9pt7b;
    captionLines = wrapText(caption, captionFont, W - 16);
    if (captionLines.size() > 3) {
      captionLines.resize(3);
      captionLines[2] += "...";
    }
  }
  qrDirty = true;
}

static void ack() {
  JsonDocument doc;
  doc["screen_face"] = kFaces[faceIndex].name;
  doc["screen_text"] = caption;
  doc["screen_qr"] = qrShown ? qrUrl.c_str() : nullptr;
  serializeJson(doc, Serial);
  Serial.println();
}

// {"type":"nfc_read"} or {"type":"nfc_write","url":"https://..."} (or "text").
// Waits up to timeout_ms (default 3000) for a tag held on the flower pattern
// (the antenna). The face pauses meanwhile. An optional "uid" makes the command
// act only on that tag. Replies with one line, e.g.
// {"nfc":"nfc_write","ok":true,"uid":"04A2...","tag":"NTAG215","uri":"https://...","verified":true}
static void handleNfc(JsonDocument& cmd) {
  JsonDocument out;
  bool writing = strcmp(cmd["type"], "nfc_write") == 0;
  out["nfc"] = cmd["type"];
  const char* url = cmd["url"];
  const char* text = cmd["text"];
  String err, kind, value;
  NfcTag tag;
  if (writing && !url && !text) {
    err = "nfc_write needs url or text";
  } else if (nfcBegin(err)) {
    const char* wantUid = cmd["uid"];
    if (!nfcFindTag(tag, cmd["timeout_ms"] | 3000)) {
      err = nfcSawMultipleTags() ? "more than one tag in range, hold just one" : "no tag found";
    } else if (wantUid && !tag.uidHex().equalsIgnoreCase(wantUid)) {
      out["uid"] = tag.uidHex();
      err = "wrong tag in range";
    } else {
      out["uid"] = tag.uidHex();
      out["tag"] = tag.kind;
      if (!writing || nfcWriteNdef(tag, url != nullptr, url ? url : text, err)) {
        if (nfcReadNdef(tag, kind, value, err)) {
          out[kind] = value;
          if (writing) out["verified"] = value == (url ? url : text);
        }
      }
    }
    nfcSleep();
  }
  out["ok"] = err.isEmpty();
  if (!err.isEmpty()) out["error"] = err;
  serializeJson(out, Serial);
  Serial.println();
  lastCommandAt = millis();
}

static void handleLine(char* line) {
  while (*line == ' ') line++;
  if (!*line) return;
  lastCommandAt = millis();
  if (*line != '{') {
    setCaption(line);
    ack();
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, line)) {
    Serial.println("{\"screen_error\":\"bad json\"}");
    return;
  }
  const char* type = doc["type"] | "screen";
  if (strcmp(type, "nfc_read") == 0 || strcmp(type, "nfc_write") == 0) {
    handleNfc(doc);
    return;
  }
  if (strcmp(type, "screen") != 0) return;  // drive, stop, ... aren't for the screen
  if (const char* face = doc["face"]) {
    int index = findFace(face);
    if (index < 0) {
      Serial.printf("{\"screen_error\":\"unknown face %s\"}\n", face);
    } else {
      setFace(index);
    }
  }
  if (doc["text"].is<const char*>()) setCaption(doc["text"].as<const char*>());
  JsonVariantConst qr = doc["qr"];
  if (qr.is<const char*>() && *qr.as<const char*>()) {
    qrUrl = qr.as<const char*>();
    qrShown = qrDirty = true;
    qrHideAt = 0;
  } else if (qr.is<bool>() && qr.as<bool>()) {
    qrShown = qrDirty = !qrUrl.isEmpty();
    qrHideAt = 0;
  } else if (qr.is<bool>() || qr.is<const char*>()) {
    qrShown = false;
    blinkStart = reactAt = millis();
  }
  ack();
}

static void pollSerial() {
  static char buf[1024];
  static size_t len = 0;
  static bool overflow = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      buf[len] = 0;
      if (!overflow) handleLine(buf);
      len = 0;
      overflow = false;
    } else if (len < sizeof(buf) - 1) {
      buf[len++] = c;
    } else {
      overflow = true;
    }
  }
}

// Returns the 74HC165 buttons as a bitmask, bit 0 = A. All are active-low.
static uint8_t readShiftButtons() {
  digitalWrite(PIN_HC165_LOAD, LOW);
  delayMicroseconds(1);
  digitalWrite(PIN_HC165_LOAD, HIGH);
  uint8_t pressed = 0;
  for (int i = 0; i < 8; i++) {
    if (digitalRead(PIN_HC165_DATA) == LOW) pressed |= 1 << i;
    digitalWrite(PIN_HC165_CLK, HIGH);
    delayMicroseconds(1);
    digitalWrite(PIN_HC165_CLK, LOW);
  }
  return pressed;
}

// True once per press, after 30 ms of debounce.
static bool pressedEdge(bool down, bool& wasDown, uint32_t& changedAt) {
  if (down == wasDown || millis() - changedAt < 30) return false;
  wasDown = down;
  changedAt = millis();
  return down;
}

static void pollButtons() {
  static bool startWas = false, aWas = false;
  static uint32_t startAt = 0, aAt = 0;
  if (pressedEdge(digitalRead(PIN_BTN_START) == LOW, startWas, startAt)) {
    qrShown = false;
    lastCommandAt = millis();
    setFace((faceIndex + 1) % kFaceCount);
    ack();
  }
  if (pressedEdge(readShiftButtons() & 0x01, aWas, aAt)) {
    qrUrl = kJoinUrl;
    qrShown = qrDirty = true;
    qrHideAt = millis() + kJoinQrMs;
    ack();
  }
}

// 1 = open, 0 = shut.
static float blinkOpenness(uint32_t now) {
  if (now >= nextBlink && now - blinkStart > 400) {
    blinkStart = now;
    doubleBlink = !doubleBlink && esp_random() % 5 == 0;
    nextBlink = now + (doubleBlink ? 250 : randBetween(2000, 5500));
  }
  uint32_t t = now - blinkStart;
  if (t >= 160) return 1.0f;
  float p = t / 160.0f;
  return p < 0.5f ? 1.0f - 2.0f * p : 2.0f * p - 1.0f;
}

static void updateGaze(uint32_t now) {
  if (now >= nextGlance) {
    bool center = esp_random() % 3 == 0;
    glanceX = center ? 0 : randSigned() * 0.6f;
    glanceY = center ? 0 : randSigned() * 0.4f;
    nextGlance = now + randBetween(1200, 3500);
  }
  gazeX += (constrain(cur.lookX + glanceX, -1.0f, 1.0f) - gazeX) * 0.2f;
  gazeY += (constrain(cur.lookY + glanceY, -1.0f, 1.0f) - gazeY) * 0.2f;
}

// While nobody has said anything for a while, neutral occasionally slips into
// a quick smile, a startled look or a big glance to one side.
static int updateFidget(uint32_t now) {
  if (faceIndex != NEUTRAL || now - lastCommandAt < 6000) return faceIndex;
  if (fidgetFace >= 0 && now >= fidgetUntil) fidgetFace = -1;
  if (fidgetFace < 0 && now >= nextFidget) {
    switch (esp_random() % 4) {
      case 0: fidgetFace = HAPPY; break;
      case 1: fidgetFace = SURPRISED; break;
      default:  // look far away, no expression change
        glanceX = esp_random() % 2 ? 1.0f : -1.0f;
        glanceY = randSigned() * 0.3f;
        nextGlance = now + 1500;
        break;
    }
    if (fidgetFace >= 0) reactAt = now;
    fidgetUntil = now + randBetween(900, 1600);
    nextFidget = now + randBetween(7000, 15000);
  }
  return fidgetFace >= 0 ? fidgetFace : faceIndex;
}

static void drawHeart(float cx, float cy, float s, uint16_t color) {
  canvas.fillSmoothCircle(cx - s * 0.5f, cy - s * 0.25f, s * 0.55f, color);
  canvas.fillSmoothCircle(cx + s * 0.5f, cy - s * 0.25f, s * 0.55f, color);
  canvas.fillTriangle(cx - s * 1.03f, cy - s * 0.05f, cx + s * 1.03f, cy - s * 0.05f, cx, cy + s * 1.1f, color);
}

// side: -1 = left eye, +1 = right eye (as the viewer sees it).
static void drawEye(float cx, float cy, int side, float openness, uint32_t now) {
  const Face& f = cur;
  if (f.heart > 0.5f) {
    float s = f.eyeW * 0.6f * (1.0f + 0.1f * sinf(now / 110.0f));
    drawHeart(cx, cy, s, kHeart);
    canvas.fillSmoothCircle(cx - s * 0.55f, cy - s * 0.4f, s * 0.15f, kPaper);
    return;
  }
  if (side > 0) openness *= 1.0f - f.winkR;
  float w = f.eyeW;
  float h = f.eyeH * openness;
  if (h < 10) {  // shut: a little smiling arc
    float px = 0, py = 0;
    for (int i = 0; i <= 8; i++) {
      float t = i / 4.0f - 1.0f;
      float x = cx + t * w * 0.45f, y = cy - 6 * (1.0f - t * t) + 3;
      if (i > 0) canvas.drawWideLine(px, py, x, y, 3.5f, kInk);
      px = x;
      py = y;
    }
    return;
  }
  float x0 = cx - w / 2, y0 = cy - h / 2;
  canvas.fillSmoothRoundRect(x0, y0, w, h, min(f.eyeR, min(w, h) / 2), kInk);
  // Glints, lit from the upper left, sell the cuteness.
  if (h > 30) {
    canvas.fillSmoothCircle(x0 + w * 0.32f, y0 + h * 0.27f, w * 0.17f, kPaper);
    canvas.fillSmoothCircle(x0 + w * 0.62f, y0 + h * 0.5f, w * 0.07f, kPaper);
  }

  // Eyelids: a paper-colored quad over the top, tilted by lidSlope.
  float base = y0 + h * f.lidTop;
  float inner = base + max(f.lidSlope, 0.0f) * h;
  float outer = base + max(-f.lidSlope, 0.0f) * h;
  if (inner > y0 + 0.5f || outer > y0 + 0.5f) {
    float xl = x0 - 3, xr = x0 + w + 3, top = y0 - 3;
    float yl = side < 0 ? outer : inner;
    float yr = side < 0 ? inner : outer;
    canvas.fillTriangle(xl, yl, xr, yr, xr, top, kPaper);
    canvas.fillTriangle(xl, yl, xr, top, xl, top, kPaper);
  }
  // Happy eyes: an ellipse bites the bottom off.
  if (f.happy > 0.01f) {
    canvas.fillEllipse(cx, y0 + h * 1.25f, w * 0.75f, h * (0.25f + f.happy), kPaper);
  }
}

static void drawCurve(float cx, float cy, float w, float curve, float amp) {
  float px = 0, py = 0;
  for (int i = 0; i <= 16; i++) {
    float t = i / 8.0f - 1.0f;
    float x = cx + t * w / 2;
    float y = cy + curve * amp * (1.0f - t * t) - curve * amp * 0.5f;
    if (i > 0) canvas.drawWideLine(px, py, x, y, 3.5f, kInk);
    px = x;
    py = y;
  }
}

static void drawMouth(float mx, float my) {
  const Face& f = cur;
  if (f.cat > 0.5f) {
    float s = f.mouthW * 0.25f;
    drawCurve(mx - s, my, s * 2, 1.0f, 10);
    drawCurve(mx + s, my, s * 2, 1.0f, 10);
  } else if (f.mouthOpen > 0.08f) {
    float rx = f.mouthW * 0.4f, ry = 4 + f.mouthOpen * 20;
    if (f.mouthCurve > 0.5f) {  // big grin: the lower half of an ellipse, with a tongue
      float cy = my - ry * 0.4f;
      canvas.fillEllipse(mx, cy, rx, ry, kInk);
      canvas.fillEllipse(mx, cy + ry * 0.65f, rx * 0.55f, ry * 0.3f, kHeart);
      canvas.fillRect(mx - rx - 1, cy - ry - 1, rx * 2 + 2, ry + 1, kPaper);
    } else {
      canvas.fillEllipse(mx, my, rx, ry, kInk);
    }
  } else {
    drawCurve(mx, my, f.mouthW, f.mouthCurve, 14);
  }
}

static void drawCaption() {
  if (captionLines.empty()) return;
  canvas.setFont(captionFont);
  canvas.setTextColor(kInk);
  canvas.setTextDatum(lgfx::bottom_center);
  int lineH = canvas.fontHeight();
  int y = H - 6 - lineH * (captionLines.size() - 1);
  for (const String& line : captionLines) {
    canvas.drawString(line, W / 2, y);
    y += lineH;
  }
}

static void renderQr() {
  if (!qrDirty) return;
  qrDirty = false;
  canvas.fillScreen(kPaper);
  // The A button's QR goes full size; the caption belongs to the face.
  bool captioned = qrHideAt == 0 && !captionLines.empty();
  int size = !captioned ? 224 : (captionLines.size() > 1 ? 160 : 190);
  canvas.qrcode(qrUrl.c_str(), (W - size) / 2, 8, size);
  if (captioned) drawCaption();
  canvas.pushSprite(0, 0);
}

static void renderFace(uint32_t now) {
  int shown = updateFidget(now);
  const Face& target = kFaces[shown].face;
  const float* to = reinterpret_cast<const float*>(&target);
  float* at = reinterpret_cast<float*>(&cur);
  for (int i = 0; i < kFaceFields; i++) at[i] += (to[i] - at[i]) * 0.22f;
  cur.heart = target.heart;  // hearts pop in rather than morph
  cur.cat = target.cat;

  layoutY += ((captionLines.empty() ? 98.0f : 76.0f) - layoutY) * 0.2f;
  updateGaze(now);
  float openness = blinkOpenness(now);
  // Gentle breathing, plus a springy hop whenever the expression changes.
  float bob = sinf(now / 700.0f) * 3.0f;
  uint32_t sinceReact = now - reactAt;
  if (sinceReact < 600) bob -= 14.0f * sinf(sinceReact / 600.0f * PI * 3) * (1.0f - sinceReact / 600.0f);

  float eyeY = layoutY + bob + gazeY * 14;
  float eyeX = W / 2 + gazeX * 22;

  canvas.fillScreen(kPaper);
  if (cur.blush > 0.05f) {
    for (int side = -1; side <= 1; side += 2) {
      float bx = eyeX + side * (70 + cur.eyeW * 0.4f);
      canvas.fillEllipse(bx, eyeY + cur.eyeH / 2 + 10, 18 * cur.blush, 9 * cur.blush, kBlush);
    }
  }
  drawEye(eyeX - 70, eyeY, -1, openness, now);
  drawEye(eyeX + 70, eyeY, +1, openness, now);
  drawMouth(W / 2 + gazeX * 8, layoutY + 76 + bob + gazeY * 5);

  if (cur.lidTop > 0.5f) {  // floating z's
    canvas.setTextColor(kInk);
    canvas.setTextDatum(lgfx::middle_center);
    float drift = (now % 2000) / 2000.0f;
    canvas.setFont(&fonts::FreeSansBold9pt7b);
    canvas.drawString("z", 262 + drift * 10, 52 - drift * 22);
    canvas.setFont(&fonts::FreeSansBold12pt7b);
    canvas.drawString("Z", 284 + drift * 10, 30 - drift * 22);
  }

  drawCaption();
  canvas.pushSprite(0, 0);
}

void setup() {
  Serial.setRxBufferSize(2048);
  Serial.setTxTimeoutMs(0);  // never stall the animation when nobody is reading
  Serial.begin(115200);
  pinMode(PIN_BTN_START, INPUT_PULLUP);
  pinMode(PIN_HC165_DATA, INPUT);
  pinMode(PIN_HC165_LOAD, OUTPUT);
  pinMode(PIN_HC165_CLK, OUTPUT);
  digitalWrite(PIN_HC165_LOAD, HIGH);
  digitalWrite(PIN_HC165_CLK, LOW);

  lcd.init();
  lcd.setRotation(1);  // matches the stock firmware's swap_xy + mirror_x
  lcd.fillScreen(kPaper);

  // A full 16-bit frame is 150 KB; fall back to 8-bit color if the heap can't fit it.
  canvas.setColorDepth(16);
  if (!canvas.createSprite(W, H)) {
    canvas.setColorDepth(8);
    canvas.createSprite(W, H);
  }
  Serial.printf("{\"screen_ready\":true,\"screen_depth\":%d}\n", canvas.getColorDepth());
}

void loop() {
  pollSerial();
  pollButtons();
  uint32_t now = millis();
  if (qrShown && qrHideAt && (int32_t)(now - qrHideAt) >= 0) {
    qrShown = false;
    qrHideAt = 0;
    blinkStart = reactAt = now;
    ack();
  }
  if (qrShown) {
    renderQr();
  } else {
    renderFace(now);
  }
}
