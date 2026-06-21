import {
  type PairingId,
  buildStopSuctionUuid,
  buildStopVibrationUuid,
  buildSuctionUuid,
  buildVibrationUuid,
} from "./protocol.js";

export type ControlAction =
  | "set_suction"
  | "set_vibration"
  | "stop_suction"
  | "stop_vibration"
  | "stop_all";

export type GeneratedUuid = string | string[];

export interface PreparedCommand {
  action: ControlAction;
  level: number | null;
  duration_ms: number;
  generated_uuid: GeneratedUuid;
}

export interface PrepareOptions {
  pairingId?: PairingId;
  allowHighLevels?: boolean;
}

const DEFAULT_PAIRING_ID = "5002";
const DEFAULT_DURATION_MS = 2000;

function normalizeDuration(durationMs: number | undefined): number {
  const value = durationMs ?? DEFAULT_DURATION_MS;
  if (!Number.isInteger(value) || value < 100 || value > 5000) {
    throw new Error("invalid_duration");
  }
  return value;
}

function normalizeLevel(level: number | undefined, allowHighLevels: boolean): number {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) {
    throw new Error("invalid_level");
  }

  if (!allowHighLevels && level > 50) {
    throw new Error("level_too_high");
  }

  return level;
}

export function prepareCommand(
  action: ControlAction,
  input: { level?: number; duration_ms?: number },
  options: PrepareOptions = {},
): PreparedCommand {
  const pairingId = options.pairingId ?? DEFAULT_PAIRING_ID;
  const duration_ms = normalizeDuration(input.duration_ms);
  const allowHighLevels = options.allowHighLevels === true;

  if (action === "set_suction") {
    const level = normalizeLevel(input.level, allowHighLevels);
    return {
      action,
      level,
      duration_ms,
      generated_uuid: buildSuctionUuid(pairingId, level),
    };
  }

  if (action === "set_vibration") {
    const level = normalizeLevel(input.level, allowHighLevels);
    return {
      action,
      level,
      duration_ms,
      generated_uuid: buildVibrationUuid(pairingId, level),
    };
  }

  if (action === "stop_suction") {
    return {
      action,
      level: null,
      duration_ms,
      generated_uuid: buildStopSuctionUuid(pairingId),
    };
  }

  if (action === "stop_vibration") {
    return {
      action,
      level: null,
      duration_ms,
      generated_uuid: buildStopVibrationUuid(pairingId),
    };
  }

  return {
    action: "stop_all",
    level: null,
    duration_ms,
    generated_uuid: [buildStopSuctionUuid(pairingId), buildStopVibrationUuid(pairingId)],
  };
}
