# Protocol Notes

This document collects Bluetooth protocol findings from the Android ELAC SUB
Control 2.0 APK.

## Transport

The Android app uses Bluetooth Low Energy GATT. There is no evidence in the
decompiled control flow of Bluetooth Classic/RFCOMM being used for the subwoofer
control protocol.

Scanning uses `BluetoothLeScanner.startScan(filters, settings, callback)` with:

- Scan mode: `ScanSettings.SCAN_MODE_LOW_LATENCY` (`2`)
- Scan filters: BLE service UUID filters for the supported services below

## Discovery Service UUIDs

`com.sonavox.elacsubs.data.a.b` defines the services the scanner and connection
logic consider compatible:

| Purpose | UUID |
| --- | --- |
| Supported service | `4719bb98-1515-4f2b-a0c1-35b860d52170` |
| Supported service, Microchip/Transparent UART style | `49535343-fe7d-4ae5-8fa9-9fafd205e455` |

Several other UUID strings are present in the APK, but static control flow shows
only the two above in the scan filter and service-match array.

## GATT Characteristics

After connecting, `BluetoothGattCallback.onServicesDiscovered` iterates services
and stores the first matching service UUID. It then enables notifications or
indications through descriptor `00002902-0000-1000-8000-00805f9b34fb`.

| Service path | Write characteristic | Notify/indicate characteristic | CCCD mode |
| --- | --- | --- | --- |
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` | `49535343-1e4d-4bd9-ba61-23c647249616` | same characteristic | `ENABLE_INDICATION_VALUE` |
| Other matched service, currently `4719bb98-1515-4f2b-a0c1-35b860d52170` | `c6a0486f-71b5-4226-9057-bf2baa8334e8` | `116bd560-2c1b-4769-b07d-85e36fc5e086` | `ENABLE_NOTIFICATION_VALUE` |

Writes are split into 20-byte chunks if needed.

## Packet Format

Packet encoding lives in `com.sonavox.elacsubs.data.a.e`.
The repo also includes an independent helper implementation in
`scripts/elac_protocol.py`.

Before byte-stuffing, the inner packet layout is:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 2 | Command id, parsed from a 4-character hex string |
| 2 | 1 | Command type |
| 3 | 1 | Command status |
| 4 | N | Payload |
| 4+N | 2 | CRC-16, big-endian |

The CRC is computed over all inner bytes before the CRC field. The lookup table
matches CRC-16/CCITT-style polynomial `0x1021` with initial value `0x0000`.

The transmitted packet is SLIP-like:

| Byte | Meaning |
| --- | --- |
| `0xC0` | frame delimiter, emitted at start and end |
| `0xDB 0xDC` | escaped literal `0xC0` |
| `0xDB 0xDD` | escaped literal `0xDB` |

Command ids are encoded big-endian because hex string `0040` becomes bytes
`00 40`. Single-byte integer payload helper stores the low byte. Short payloads
are mixed: generic `short` helper is little-endian, while PEQ filter fields are
manually stored high-byte second / low-byte first in the payload and decoded
with big-endian slices. This needs dynamic confirmation before implementing a
controller.

## Command Types And Status

Observed command type usage:

| Type | App usage |
| ---: | --- |
| `0` | Read/query command |
| `1` | Write/set command |

Receive handling suggests:

- `commandStatus != 0` and `commandId != 0`: ACK path.
- `commandStatus == 0` and `commandId != 0`: data response path.
- `commandId == 0`: return/status path.

## Command IDs

Confirmed from repository and UI code:

| Command id | Direction | App meaning inferred from storage/UI |
| --- | --- | --- |
| `0040` | read/write | Master volume |
| `004A` | read/write | Preset |
| `004B` | read/write | Delay, payload value appears to be tenths |
| `0049` | read/write | Parametric EQ filter. Reads pass filter index/type bytes; writes use a 9-byte filter payload |
| `0024` | read/write | Subwoofer name string, null-terminated on write |
| `0022` | read/write | Power mode |
| `0023` | read/write | Power threshold |
| `0172` | read/write | Auto EQ enabled flag |
| `0170` | read | Auto EQ calibrated flag |
| `0001` | read | Firmware version string |
| `0002` | read | Hardware version string |
| `0004` | read | Manufacturer name string; parsed but not included in the default refresh sequence |
| `0005` | read | Model name string |
| `01D0` | read | IP address string |
| `0152` | read | LED brightness, parsed but not included in the default refresh sequence |
| `0174` | write | Two-byte flag payload; likely LED/auto-EQ related, needs confirmation |
| `0177` | write type `0` | Two-byte flag payload; likely setup/measurement related, needs confirmation |
| `0021` | write | Triggers a refresh/reconnect-like path in response handling |
| `0175` | write | Auto EQ/setup action, needs confirmation |

## PEQ Filter Payload

Filter payloads are 9 bytes:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 1 | Always `0` in app-created writes |
| 1 | 1 | Filter index |
| 2 | 1 | Filter type |
| 3..4 | 2 | Frequency times 10 |
| 5..6 | 2 | Q/quality scaled by 100 |
| 7..8 | 2 | Gain scaled by 10 |

The exact signedness/ranges should be verified against live captures.

## Open Questions

- Which of the two service paths does the SUB 2050 firmware actually advertise?
- Confirm payload endianness for all multi-byte values with live BLE captures.
- Confirm the meanings of command ids `0174`, `0177`, `0021`, and `0175`.
- Determine value ranges and units for volume, delay, power threshold, preset,
  LED brightness, and Auto EQ flags.
