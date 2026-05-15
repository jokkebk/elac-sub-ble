"""Helpers for the ELAC SUB Control 2.0 BLE packet format.

This is based on static analysis of `com.sonavox.elacsubs.data.a.e` in APK
version 0.0.22. It intentionally does not contain any ELAC APK code.
"""

from __future__ import annotations

from dataclasses import dataclass

FRAME = 0xC0
ESC = 0xDB
ESC_FRAME = 0xDC
ESC_ESC = 0xDD


def crc16_ccitt_zero(data: bytes) -> int:
    """CRC table equivalent to the APK's command packet CRC."""
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def slip_escape(inner: bytes) -> bytes:
    out = bytearray([FRAME])
    for byte in inner:
        if byte == FRAME:
            out.extend([ESC, ESC_FRAME])
        elif byte == ESC:
            out.extend([ESC, ESC_ESC])
        else:
            out.append(byte)
    out.append(FRAME)
    return bytes(out)


def slip_unescape(frame: bytes) -> bytes:
    out = bytearray()
    in_frame = False
    i = 0
    while i < len(frame):
        byte = frame[i]
        if byte == FRAME:
            if in_frame and out:
                break
            in_frame = True
            i += 1
            continue
        if byte == ESC:
            i += 1
            if i >= len(frame):
                raise ValueError("dangling escape byte")
            escaped = frame[i]
            if escaped == ESC_FRAME:
                byte = FRAME
            elif escaped == ESC_ESC:
                byte = ESC
            else:
                raise ValueError(f"unknown escape byte 0x{escaped:02x}")
        if in_frame:
            out.append(byte)
        i += 1
    return bytes(out)


@dataclass(frozen=True)
class Packet:
    command_id: str
    command_type: int
    status: int = 0
    payload: bytes = b""

    def encode_inner(self) -> bytes:
        command = bytes.fromhex(self.command_id)
        if len(command) != 2:
            raise ValueError("command_id must be exactly two bytes, e.g. '0040'")
        body = command + bytes([self.command_type & 0xFF, self.status & 0xFF]) + self.payload
        crc = crc16_ccitt_zero(body).to_bytes(2, "big")
        return body + crc

    def encode_frame(self) -> bytes:
        return slip_escape(self.encode_inner())

    @classmethod
    def decode_frame(cls, frame: bytes) -> "Packet":
        inner = slip_unescape(frame)
        if len(inner) < 6:
            raise ValueError("packet too short")
        body, crc_bytes = inner[:-2], inner[-2:]
        actual_crc = int.from_bytes(crc_bytes, "big")
        expected_crc = crc16_ccitt_zero(body)
        if actual_crc != expected_crc:
            raise ValueError(f"CRC mismatch: got 0x{actual_crc:04x}, expected 0x{expected_crc:04x}")
        return cls(
            command_id=body[:2].hex().upper(),
            command_type=body[2],
            status=body[3],
            payload=body[4:],
        )


def int_payload(value: int) -> bytes:
    return bytes([value & 0xFF])


def null_terminated_string_payload(value: str) -> bytes:
    return value.encode() + b"\x00"
