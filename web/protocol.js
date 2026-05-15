export const FRAME = 0xc0;
export const ESC = 0xdb;
export const ESC_FRAME = 0xdc;
export const ESC_ESC = 0xdd;

export const READ_COMMANDS = [
  { id: "0040", name: "Master volume", kind: "uint8" },
  { id: "004A", name: "Preset", kind: "uint8" },
  { id: "004B", name: "Delay", kind: "tenths" },
  { id: "0024", name: "Subwoofer name", kind: "cstring" },
  { id: "0022", name: "Power mode", kind: "uint8" },
  { id: "0023", name: "Power threshold", kind: "uint8" },
  { id: "0172", name: "Auto EQ enabled", kind: "boolish" },
  { id: "0170", name: "Auto EQ calibrated", kind: "boolish" },
  { id: "0001", name: "Firmware version", kind: "cstring" },
  { id: "0002", name: "Hardware version", kind: "cstring" },
  { id: "0005", name: "Model name", kind: "cstring" },
  { id: "01D0", name: "IP address", kind: "cstring" },
  { id: "0004", name: "Manufacturer name", kind: "cstring", optional: true },
  { id: "0152", name: "LED brightness", kind: "uint8", optional: true },
];

export function crc16CcittZero(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

export function slipEscape(inner) {
  const out = [FRAME];
  for (const byte of inner) {
    if (byte === FRAME) {
      out.push(ESC, ESC_FRAME);
    } else if (byte === ESC) {
      out.push(ESC, ESC_ESC);
    } else {
      out.push(byte);
    }
  }
  out.push(FRAME);
  return new Uint8Array(out);
}

export function slipUnescape(frame) {
  const out = [];
  let inFrame = false;
  for (let i = 0; i < frame.length; i += 1) {
    let byte = frame[i];
    if (byte === FRAME) {
      if (inFrame && out.length) {
        break;
      }
      inFrame = true;
      continue;
    }
    if (!inFrame) {
      continue;
    }
    if (byte === ESC) {
      i += 1;
      if (i >= frame.length) {
        throw new Error("dangling escape byte");
      }
      const escaped = frame[i];
      if (escaped === ESC_FRAME) {
        byte = FRAME;
      } else if (escaped === ESC_ESC) {
        byte = ESC;
      } else {
        throw new Error(`unknown escape byte 0x${escaped.toString(16).padStart(2, "0")}`);
      }
    }
    out.push(byte);
  }
  return new Uint8Array(out);
}

export function encodeReadFrame(commandId, payload = new Uint8Array()) {
  return encodeFrame({ commandId, commandType: 0, status: 0, payload });
}

export function encodeFrame({ commandId, commandType, status = 0, payload = new Uint8Array() }) {
  const command = bytesFromHex(commandId);
  if (command.length !== 2) {
    throw new Error("commandId must be exactly two bytes, e.g. 0040");
  }
  if (commandType !== 0) {
    throw new Error("read-only client only permits command type 0");
  }
  const body = new Uint8Array(4 + payload.length);
  body.set(command, 0);
  body[2] = commandType & 0xff;
  body[3] = status & 0xff;
  body.set(payload, 4);
  const crc = crc16CcittZero(body);
  const inner = new Uint8Array(body.length + 2);
  inner.set(body, 0);
  inner[inner.length - 2] = (crc >> 8) & 0xff;
  inner[inner.length - 1] = crc & 0xff;
  return slipEscape(inner);
}

export function decodeFrame(frame) {
  const inner = slipUnescape(frame);
  if (inner.length < 6) {
    throw new Error("packet too short");
  }
  const body = inner.slice(0, inner.length - 2);
  const actualCrc = (inner[inner.length - 2] << 8) | inner[inner.length - 1];
  const expectedCrc = crc16CcittZero(body);
  if (actualCrc !== expectedCrc) {
    throw new Error(
      `CRC mismatch: got 0x${actualCrc.toString(16).padStart(4, "0")}, expected 0x${expectedCrc
        .toString(16)
        .padStart(4, "0")}`,
    );
  }
  return {
    commandId: commandIdFromBytes(body.slice(0, 2)),
    commandType: body[2],
    status: body[3],
    payload: body.slice(4),
    crc: actualCrc,
  };
}

export function extractSlipFrames(buffer) {
  const frames = [];
  let start = -1;
  let consumedUntil = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== FRAME) {
      continue;
    }
    if (start === -1) {
      start = i;
    } else if (i > start + 1) {
      frames.push(buffer.slice(start, i + 1));
      consumedUntil = i + 1;
      start = i;
    } else {
      start = i;
    }
  }
  if (start === -1 || consumedUntil === buffer.length) {
    return { frames, remainder: new Uint8Array() };
  }
  return { frames, remainder: buffer.slice(start) };
}

export function interpretPayload(commandId, payload) {
  const command = READ_COMMANDS.find((item) => item.id === commandId);
  if (!command) {
    return "";
  }
  if (payload.length === 0) {
    return "";
  }
  switch (command.kind) {
    case "cstring":
      return decodeCString(payload);
    case "tenths":
      return `${payload[0] / 10}`;
    case "boolish":
      return payload[0] === 0 ? "false / 0" : `true / ${payload[0]}`;
    case "uint8":
      return `${payload[0]}`;
    default:
      return hexFromBytes(payload);
  }
}

export function bytesFromHex(hex) {
  const compact = hex.replace(/[^0-9a-f]/gi, "");
  if (compact.length % 2 !== 0) {
    throw new Error("hex string has an odd number of digits");
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function hexFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function commandIdFromBytes(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function decodeCString(payload) {
  const end = payload.indexOf(0);
  const bytes = end === -1 ? payload : payload.slice(0, end);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
