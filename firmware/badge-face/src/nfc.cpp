#include "nfc.h"

#include <Wire.h>

// Pin map and address from hackthenorth/badge-firmware docs/CUSTOM-FIRMWARE-HAL.md.
static constexpr int PIN_I2C_SDA = 5;
static constexpr int PIN_I2C_SCL = 6;
static constexpr uint8_t kAddr = 0x26;

// MFRC522 registers and commands (datasheet section 9).
enum : uint8_t {
  CommandReg = 0x01, ComIrqReg = 0x04, ErrorReg = 0x06, FIFODataReg = 0x09,
  FIFOLevelReg = 0x0A, ControlReg = 0x0C, BitFramingReg = 0x0D, ModeReg = 0x11,
  TxModeReg = 0x12, RxModeReg = 0x13, TxControlReg = 0x14, TxASKReg = 0x15,
  ModWidthReg = 0x24, TModeReg = 0x2A, TPrescalerReg = 0x2B, TReloadRegH = 0x2C,
  TReloadRegL = 0x2D, VersionReg = 0x37,
};
enum : uint8_t { PCD_Idle = 0x00, PCD_Transceive = 0x0C, PCD_SoftReset = 0x0F };

static bool started = false;
static bool sawCollision = false;  // two tags answered at once during the last search

static void writeReg(uint8_t reg, const uint8_t* data, size_t len) {
  Wire.beginTransmission(kAddr);
  Wire.write(reg);
  Wire.write(data, len);
  Wire.endTransmission();
}

static void writeReg(uint8_t reg, uint8_t value) { writeReg(reg, &value, 1); }

// Over I2C the MFRC522 does not auto-increment, so a multi-byte read of
// FIFODataReg drains the FIFO.
static void readReg(uint8_t reg, uint8_t* out, size_t len) {
  Wire.beginTransmission(kAddr);
  Wire.write(reg);
  Wire.endTransmission(false);
  size_t got = Wire.requestFrom(kAddr, (uint8_t)len);
  for (size_t i = 0; i < len; i++) out[i] = i < got ? Wire.read() : 0;
}

static uint8_t readReg(uint8_t reg) {
  uint8_t v;
  readReg(reg, &v, 1);
  return v;
}

static void antenna(bool on) {
  uint8_t v = readReg(TxControlReg);
  writeReg(TxControlReg, on ? (v | 0x03) : (v & ~0x03));
}

// ISO 14443-3 CRC_A, appended little-endian.
static void crcA(const uint8_t* data, size_t len, uint8_t* out) {
  uint16_t crc = 0x6363;
  for (size_t i = 0; i < len; i++) {
    uint8_t b = data[i] ^ (uint8_t)crc;
    b ^= b << 4;
    crc = (crc >> 8) ^ ((uint16_t)b << 8) ^ ((uint16_t)b << 3) ^ (b >> 4);
  }
  out[0] = crc & 0xFF;
  out[1] = crc >> 8;
}

// Sends a frame and returns the number of bytes received, or -1 on timeout or
// error. txLastBits sends a short final byte (7 for REQA/WUPA).
static int transceive(const uint8_t* tx, size_t txLen, uint8_t* rx, size_t rxMax,
                      uint8_t txLastBits = 0, uint8_t* rxLastBits = nullptr) {
  writeReg(CommandReg, PCD_Idle);
  writeReg(ComIrqReg, 0x7F);
  writeReg(FIFOLevelReg, 0x80);
  writeReg(FIFODataReg, tx, txLen);
  writeReg(BitFramingReg, txLastBits);
  writeReg(CommandReg, PCD_Transceive);
  writeReg(BitFramingReg, 0x80 | txLastBits);  // StartSend
  uint32_t start = millis();
  while (true) {
    uint8_t irq = readReg(ComIrqReg);
    if (irq & 0x30) break;            // RxIRq or IdleIRq
    if (irq & 0x01) return -1;        // the 25 ms timer ran out: no answer
    if (millis() - start > 60) return -1;
  }
  uint8_t err = readReg(ErrorReg);
  if (err & 0x08) sawCollision = true;
  if (err & 0x1B) return -1;  // buffer overflow, collision, parity, protocol
  uint8_t n = readReg(FIFOLevelReg);
  if (n == 0 || n > rxMax) return -1;
  readReg(FIFODataReg, rx, n);
  if (rxLastBits) *rxLastBits = readReg(ControlReg) & 0x07;
  return n;
}

// Sends cmd + CRC and checks the CRC on a reply of exactly rxLen data bytes.
static bool command(const uint8_t* cmd, size_t len, uint8_t* rx, size_t rxLen) {
  uint8_t tx[24];
  memcpy(tx, cmd, len);
  crcA(tx, len, tx + len);
  uint8_t buf[34];
  if (transceive(tx, len + 2, buf, sizeof(buf)) != (int)rxLen + 2) return false;
  uint8_t crc[2];
  crcA(buf, rxLen, crc);
  if (crc[0] != buf[rxLen] || crc[1] != buf[rxLen + 1]) return false;
  memcpy(rx, buf, rxLen);
  return true;
}

String NfcTag::uidHex() const {
  String s;
  char b[3];
  for (int i = 0; i < uidLen; i++) {
    snprintf(b, sizeof(b), "%02X", uid[i]);
    s += b;
  }
  return s;
}

bool nfcBegin(String& err) {
  if (!started) {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 100000);
    Wire.setTimeOut(50);
  }
  writeReg(CommandReg, PCD_SoftReset);
  delay(50);
  uint8_t version = readReg(VersionReg);
  if (version == 0x00 || version == 0xFF) {
    err = "NFC reader not responding";
    return false;
  }
  writeReg(TxModeReg, 0x00);
  writeReg(RxModeReg, 0x00);
  writeReg(ModWidthReg, 0x26);
  writeReg(TModeReg, 0x80);  // timer starts after each transmission
  writeReg(TPrescalerReg, 0xA9);  // 40 kHz ticks
  writeReg(TReloadRegH, 0x03);    // 1000 ticks = 25 ms timeout
  writeReg(TReloadRegL, 0xE8);
  writeReg(TxASKReg, 0x40);  // 100% ASK
  writeReg(ModeReg, 0x3D);   // CRC preset 0x6363
  antenna(true);
  started = true;
  return true;
}

static bool selectTag(NfcTag& tag) {
  uint8_t wupa = 0x52, atqa[2];
  if (transceive(&wupa, 1, atqa, 2, 7) != 2) return false;
  tag.uidLen = 0;
  for (uint8_t level : {0x93, 0x95, 0x97}) {
    uint8_t anticoll[2] = {level, 0x20}, r[5];
    if (transceive(anticoll, 2, r, 5) != 5) return false;
    if ((r[0] ^ r[1] ^ r[2] ^ r[3]) != r[4]) return false;
    uint8_t sel[7] = {level, 0x70, r[0], r[1], r[2], r[3], r[4]}, sak;
    if (!command(sel, 7, &sak, 1)) return false;
    bool cascade = r[0] == 0x88;  // more UID bytes at the next level
    memcpy(tag.uid + tag.uidLen, r + (cascade ? 1 : 0), cascade ? 3 : 4);
    tag.uidLen += cascade ? 3 : 4;
    if (!(sak & 0x04)) {
      tag.sak = sak;
      return true;
    }
  }
  return false;
}

// GET_VERSION is unknown to the original Ultralight, which halts on it.
static bool versionUnsupported = false;

static const char* identify(uint8_t sak) {
  versionUnsupported = false;
  switch (sak) {
    case 0x08: return "MIFARE Classic 1K";
    case 0x18: return "MIFARE Classic 4K";
    case 0x20: return "ISO-DEP (phone or DESFire)";
    case 0x00: break;
    default: return "unknown";
  }
  uint8_t getVersion = 0x60, v[8];
  if (!command(&getVersion, 1, v, 8)) {
    versionUnsupported = true;
    return "MIFARE Ultralight";
  }
  if (v[2] == 0x04) {
    switch (v[6]) {
      case 0x0F: return "NTAG213";
      case 0x11: return "NTAG215";
      case 0x13: return "NTAG216";
    }
    return "NTAG";
  }
  return "MIFARE Ultralight";
}

bool nfcFindTag(NfcTag& tag, uint32_t timeoutMs) {
  uint32_t start = millis();
  sawCollision = false;
  do {
    if (selectTag(tag)) {
      tag.kind = identify(tag.sak);
      if (versionUnsupported) selectTag(tag);
      return true;
    }
    delay(20);
  } while (millis() - start < timeoutMs);
  return false;
}

bool nfcSawMultipleTags() { return sawCollision; }

static bool readPages(uint8_t page, uint8_t* out16) {
  uint8_t cmd[2] = {0x30, page};
  return command(cmd, 2, out16, 16);
}

static bool writePage(uint8_t page, const uint8_t* data4) {
  uint8_t tx[8] = {0xA2, page, data4[0], data4[1], data4[2], data4[3]};
  crcA(tx, 6, tx + 6);
  uint8_t ack, bits;
  return transceive(tx, 8, &ack, 1, 0, &bits) == 1 && bits == 4 && (ack & 0x0F) == 0x0A;
}

static const char* const kUriPrefixes[] = {
    "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
    "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://",
    "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
    "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
    "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
    "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
};
static constexpr int kUriPrefixCount = sizeof(kUriPrefixes) / sizeof(kUriPrefixes[0]);

// Capability container (page 3): E1, version, data area size / 8, access.
static bool readCapacity(const NfcTag& tag, size_t& capacity, String& err) {
  if (tag.sak != 0x00) {
    err = String("can't do NDEF on ") + tag.kind + ", use an NTAG sticker";
    return false;
  }
  uint8_t p[16];
  if (!readPages(3, p)) {
    err = "read failed";
    return false;
  }
  if (p[0] != 0xE1) {
    err = "tag is not NDEF formatted";
    return false;
  }
  capacity = p[2] * 8;
  return true;
}

bool nfcReadNdef(const NfcTag& tag, String& kind, String& value, String& err) {
  size_t capacity;
  if (!readCapacity(tag, capacity, err)) return false;
  // Pull the data area in 16-byte reads until the NDEF message is covered.
  uint8_t data[512];
  size_t have = 0;
  auto ensure = [&](size_t n) {
    n = min(n, min(capacity, sizeof(data)));
    while (have < n) {
      if (!readPages(4 + have / 4, data + have)) return false;
      have += 16;
    }
    return true;
  };
  size_t i = 0;
  while (true) {  // walk TLVs to the NDEF message
    if (!ensure(i + 4)) { err = "read failed"; return false; }
    if (i >= capacity || data[i] == 0xFE) { kind = "empty"; return true; }
    if (data[i] == 0x00) { i++; continue; }
    size_t len = data[i + 1], hdr = 2;
    if (len == 0xFF) { len = (data[i + 2] << 8) | data[i + 3]; hdr = 4; }
    if (data[i] == 0x03) { i += hdr; if (len == 0) { kind = "empty"; return true; } break; }
    i += hdr + len;
  }
  if (!ensure(i + 264)) { err = "read failed"; return false; }
  uint8_t h = data[i], typeLen = data[i + 1];
  bool shortRecord = h & 0x10, hasId = h & 0x08;
  size_t p = i + 2, payloadLen;
  if (shortRecord) {
    payloadLen = data[p++];
  } else {
    payloadLen = ((size_t)data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3];
    p += 4;
  }
  uint8_t idLen = hasId ? data[p++] : 0;
  const uint8_t* type = data + p;
  const uint8_t* payload = type + typeLen + idLen;
  if (payload + payloadLen > data + have) { err = "NDEF record too long"; return false; }
  uint8_t tnf = h & 0x07;
  if (tnf == 1 && typeLen == 1 && type[0] == 'U' && payloadLen >= 1) {
    kind = "uri";
    value = payload[0] < kUriPrefixCount ? kUriPrefixes[payload[0]] : "";
    for (size_t k = 1; k < payloadLen; k++) value += (char)payload[k];
  } else if (tnf == 1 && typeLen == 1 && type[0] == 'T' && payloadLen >= 1) {
    kind = "text";
    value = "";
    for (size_t k = 1 + (payload[0] & 0x3F); k < payloadLen; k++) value += (char)payload[k];
  } else {
    kind = "other";
    value = String("TNF ") + tnf;
  }
  return true;
}

bool nfcWriteNdef(const NfcTag& tag, bool isUri, const String& value, String& err) {
  size_t capacity;
  if (!readCapacity(tag, capacity, err)) return false;

  uint8_t payload[260];
  size_t payloadLen = 0;
  if (isUri) {
    int best = 0;
    for (int k = 1; k < kUriPrefixCount; k++) {
      if (value.startsWith(kUriPrefixes[k]) && strlen(kUriPrefixes[k]) > strlen(kUriPrefixes[best])) best = k;
    }
    payload[payloadLen++] = best;
    String rest = value.substring(strlen(kUriPrefixes[best]));
    if (rest.length() > 250) { err = "too long"; return false; }
    memcpy(payload + payloadLen, rest.c_str(), rest.length());
    payloadLen += rest.length();
  } else {
    if (value.length() > 250) { err = "too long"; return false; }
    payload[payloadLen++] = 0x02;  // UTF-8, 2-byte language code
    payload[payloadLen++] = 'e';
    payload[payloadLen++] = 'n';
    memcpy(payload + payloadLen, value.c_str(), value.length());
    payloadLen += value.length();
  }

  // One short record (MB|ME|SR, well-known type) in an NDEF TLV, then a terminator.
  uint8_t msg[272];
  size_t n = 0;
  size_t recordLen = 4 + payloadLen;
  msg[n++] = 0x03;
  msg[n++] = recordLen;  // < 0xFF, so the 1-byte length form
  msg[n++] = 0xD1;
  msg[n++] = 0x01;
  msg[n++] = payloadLen;
  msg[n++] = isUri ? 'U' : 'T';
  memcpy(msg + n, payload, payloadLen);
  n += payloadLen;
  msg[n++] = 0xFE;
  if (n > capacity) {
    err = String("needs ") + n + " bytes, tag holds " + capacity;
    return false;
  }
  while (n % 4) msg[n++] = 0x00;

  for (size_t off = 0; off < n; off += 4) {
    if (!writePage(4 + off / 4, msg + off)) {
      err = String("write failed at page ") + (4 + off / 4) + " (locked, or tag moved)";
      return false;
    }
  }
  return true;
}

void nfcSleep() {
  if (!started) return;
  uint8_t halt[2] = {0x50, 0x00}, tx[4], rx[1];
  memcpy(tx, halt, 2);
  crcA(halt, 2, tx + 2);
  transceive(tx, 4, rx, 1);  // a halted tag doesn't answer
  antenna(false);
}
