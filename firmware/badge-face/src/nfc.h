// Minimal MFRC522 (I2C 0x26) driver for reading and writing NDEF on NTAG21x /
// MIFARE Ultralight tags, the stickers used for the capsules.
#pragma once

#include <Arduino.h>

struct NfcTag {
  uint8_t uid[10];
  uint8_t uidLen;
  uint8_t sak;
  const char* kind;  // "NTAG213", "NTAG215", "MIFARE Classic 1K", ...
  String uidHex() const;
};

// Powers up the reader. Safe to call repeatedly.
bool nfcBegin(String& err);
// Waits up to timeoutMs for a tag in the field and selects it. Only the selected
// tag answers later reads and writes; any others in the field stay quiet.
bool nfcFindTag(NfcTag& tag, uint32_t timeoutMs);
// After a failed nfcFindTag: true if several tags were answering at once.
bool nfcSawMultipleTags();
// Reads the first NDEF record. kind is "uri", "text", "empty" or "other".
bool nfcReadNdef(const NfcTag& tag, String& kind, String& value, String& err);
// Replaces the tag's NDEF message with one URI (isUri) or text record.
bool nfcWriteNdef(const NfcTag& tag, bool isUri, const String& value, String& err);
// Halts the tag and turns the antenna off.
void nfcSleep();
