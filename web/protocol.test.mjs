import assert from "node:assert/strict";
import {
  bytesFromHex,
  crc16CcittZero,
  decodeFrame,
  encodeFrame,
  encodeReadFrame,
  encodeWriteFrame,
  extractSlipFrames,
  hexFromBytes,
  littleEndianUint16Payload,
  nullTerminatedStringPayload,
  slipEscape,
  slipUnescape,
  uint8Payload,
} from "./protocol.js";

const sampleWriteFrame = bytesFromHex("c0 00 40 01 00 4b a0 03 c0");
const samplePacket = decodeFrame(sampleWriteFrame);
assert.equal(samplePacket.commandId, "0040");
assert.equal(samplePacket.commandType, 1);
assert.equal(samplePacket.status, 0);
assert.equal(hexFromBytes(samplePacket.payload), "4b");
assert.equal(samplePacket.crc, 0xa003);

assert.equal(crc16CcittZero(bytesFromHex("00 40 01 00 4b")), 0xa003);
assert.equal(hexFromBytes(encodeReadFrame("0040")), "c0 00 40 00 00 1d ad c0");
assert.equal(hexFromBytes(encodeWriteFrame("0040", uint8Payload(75))), "c0 00 40 01 00 4b a0 03 c0");

assert.throws(
  () => encodeFrame({ commandId: "0040", commandType: 3, payload: new Uint8Array([0x4b]) }),
  /command type/,
);

assert.equal(hexFromBytes(littleEndianUint16Payload(42)), "2a 00");
assert.equal(hexFromBytes(nullTerminatedStringPayload("SUB-2050")), "53 55 42 2d 32 30 35 30 00");

const escaped = slipEscape(bytesFromHex("00 c0 db 01"));
assert.equal(hexFromBytes(escaped), "c0 00 db dc db dd 01 c0");
assert.equal(hexFromBytes(slipUnescape(escaped)), "00 c0 db 01");

const stream = bytesFromHex("01 c0 00 40 00 00 1d ad c0 c0 00 4a 00 00 c9 b5 c0 aa");
const extracted = extractSlipFrames(stream);
assert.equal(extracted.frames.length, 2);
assert.equal(hexFromBytes(extracted.frames[0]), "c0 00 40 00 00 1d ad c0");
assert.equal(hexFromBytes(extracted.frames[1]), "c0 00 4a 00 00 c9 b5 c0");
assert.equal(hexFromBytes(extracted.remainder), "c0 aa");

const exactSingleFrame = extractSlipFrames(bytesFromHex("c0 01 52 00 02 66 58 c0"));
assert.equal(exactSingleFrame.frames.length, 1);
assert.equal(hexFromBytes(exactSingleFrame.frames[0]), "c0 01 52 00 02 66 58 c0");
assert.equal(exactSingleFrame.remainder.length, 0);

console.log("protocol tests passed");
