import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStopSuctionUuid,
  buildStopVibrationUuid,
  buildSuctionUuid,
  buildVibrationUuid,
  checksum,
} from "../server/src/protocol.ts";
import { prepareCommand } from "../server/src/control.ts";

test("checksum sums the first 15 bytes and keeps the low 8 bits", () => {
  assert.equal(
    checksum([0x71, 0x00, 0x02, 0xdb, 0x04, 0x00, 0x50, 0x02, 0x03, 0x02, 0x22, 0x00, 0x00, 0x00, 0x00]),
    0xcb,
  );
});

test("builds required command UUIDs for pairing ID 5002", () => {
  assert.equal(buildSuctionUuid(5002, 34), "710002db-0400-5002-0302-2200000000cb");
  assert.equal(buildVibrationUuid(5002, 34), "710002f8-0400-5002-050a-2200000000f2");
  assert.equal(buildStopSuctionUuid(5002), "710002df-0400-5002-0302-0000000000ad");
  assert.equal(buildStopVibrationUuid(5002), "710002ed-0400-5002-0601-0000000000bd");
});

test("rejects invalid levels", () => {
  assert.throws(() => prepareCommand("set_suction", { level: -1 }), /invalid_level/);
  assert.throws(() => prepareCommand("set_suction", { level: 101 }), /invalid_level/);
});

test("rejects invalid durations", () => {
  assert.throws(() => prepareCommand("set_suction", { level: 10, duration_ms: 0 }), /invalid_duration/);
  assert.throws(() => prepareCommand("set_suction", { level: 10, duration_ms: 999999 }), /invalid_duration/);
});

test("rejects high levels unless explicitly enabled", () => {
  assert.throws(() => prepareCommand("set_vibration", { level: 51 }), /level_too_high/);
  assert.equal(
    prepareCommand("set_vibration", { level: 51 }, { allowHighLevels: true }).generated_uuid,
    "710002f8-0400-5002-050a-330000000003",
  );
});
