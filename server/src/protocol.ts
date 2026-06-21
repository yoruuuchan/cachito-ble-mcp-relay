export type PairingId = string | number;

function pairingIdBytes(pairingId: PairingId): [number, number] {
  const text = String(pairingId).trim().toLowerCase();
  if (!/^[0-9a-f]{1,4}$/.test(text)) {
    throw new Error("invalid_pairing_id");
  }

  const padded = text.padStart(4, "0");
  return [Number.parseInt(padded.slice(0, 2), 16), Number.parseInt(padded.slice(2, 4), 16)];
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 100) {
    throw new Error("invalid_level");
  }
}

function uuidFromBytes(bytes: number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function checksum(bytes15: number[]): number {
  if (bytes15.length !== 15) {
    throw new Error("checksum_requires_15_bytes");
  }

  return bytes15.reduce((sum, byte) => sum + byte, 0) & 0xff;
}

function buildUuid(firstBytes: number[], pairingId: PairingId, tailBytes: number[]): string {
  const [pairHi, pairLo] = pairingIdBytes(pairingId);
  const bytes15 = [...firstBytes, pairHi, pairLo, ...tailBytes];
  return uuidFromBytes([...bytes15, checksum(bytes15)]);
}

export function buildSuctionUuid(pairingId: PairingId, level: number): string {
  assertLevel(level);
  return buildUuid([0x71, 0x00, 0x02, 0xdb, 0x04, 0x00], pairingId, [
    0x03,
    0x02,
    level,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

export function buildVibrationUuid(pairingId: PairingId, level: number): string {
  assertLevel(level);
  return buildUuid([0x71, 0x00, 0x02, 0xf8, 0x04, 0x00], pairingId, [
    0x05,
    0x0a,
    level,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

export function buildStopSuctionUuid(pairingId: PairingId): string {
  return buildUuid([0x71, 0x00, 0x02, 0xdf, 0x04, 0x00], pairingId, [
    0x03,
    0x02,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

export function buildStopVibrationUuid(pairingId: PairingId): string {
  return buildUuid([0x71, 0x00, 0x02, 0xed, 0x04, 0x00], pairingId, [
    0x06,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}
