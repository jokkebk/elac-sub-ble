# Protocol Notes

This document collects Bluetooth protocol findings from the Android ELAC SUB
Control 2.0 APK.

## Transport

The Android app uses Bluetooth Low Energy GATT. There is no evidence in the
decompiled control flow of Bluetooth Classic/RFCOMM being used for the subwoofer
control protocol.

The repository now includes a read-only browser diagnostic client in `web/`.
It uses Chrome/Edge Web Bluetooth as a BLE GATT central, not as a peripheral
emulator. Serve the repository over `localhost` and open `/web/` to connect to a
physical subwoofer, inspect the matched service path, run read/query commands,
and export decoded JSON logs.

Scanning uses `BluetoothLeScanner.startScan(filters, settings, callback)` with:

- Scan mode: `ScanSettings.SCAN_MODE_LOW_LATENCY` (`2`)
- Scan filters: BLE service UUID filters for the supported services below

## Discovery Service UUIDs

`com.sonavox.elacsubs.data.a.b` defines the services the scanner and connection
logic consider compatible:

| Purpose | UUID |
| --- | --- |
| SUB 2050 live service, confirmed through Chrome Web Bluetooth | `57047866-4794-421b-bacf-68a120b4f339` |
| Supported service from Android static path, not present on tested SUB 2050 | `4719bb98-1515-4f2b-a0c1-35b860d52170` |
| Supported service, Microchip/Transparent UART style | `49535343-fe7d-4ae5-8fa9-9fafd205e455` |

Several other UUID strings are present in the APK, but static control flow shows
only the two above in the scan filter and service-match array.

## GATT Characteristics

After connecting, `BluetoothGattCallback.onServicesDiscovered` iterates services
and stores the first matching service UUID. It then enables notifications or
indications through descriptor `00002902-0000-1000-8000-00805f9b34fb`.

| Service path | Write characteristic | Notify/indicate characteristic | CCCD mode |
| --- | --- | --- | --- |
| `57047866-4794-421b-bacf-68a120b4f339` | `c6a0486f-71b5-4226-9057-bf2baa8334e8` | `116bd560-2c1b-4769-b07d-85e36fc5e086` | notifications |
| `49535343-fe7d-4ae5-8fa9-9fafd205e455` | `49535343-1e4d-4bd9-ba61-23c647249616` | same characteristic | `ENABLE_INDICATION_VALUE` |
| `4719bb98-1515-4f2b-a0c1-35b860d52170` | `c6a0486f-71b5-4226-9057-bf2baa8334e8` | `116bd560-2c1b-4769-b07d-85e36fc5e086` | `ENABLE_NOTIFICATION_VALUE` |

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

Receive handling is more nuanced than the first static pass suggested. A live
read of master volume sent `c0 00 40 00 00 1d ad c0` and received
`c0 00 40 00 01 2a d8 85 c0`, decoded as command `0040`, type `0`, status `1`,
payload `2a`. The payload matched a master volume setting of decimal `42`.

Static receive handling still suggests:

- `commandStatus != 0` and `commandId != 0`: ACK/data callback path.
- `commandStatus == 0` and `commandId != 0`: queued data response path.
- `commandId == 0`: return/status path.

The Web Bluetooth diagnostic client now has a guarded write tab. Volume `0040`
uses a one-byte payload and is the only write without an additional confirmation
prompt. Other write controls require browser confirmation and should be treated
as experimental until more read/write pairs are captured.

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

## Live SUB 2050 Read Capture

Chrome Web Bluetooth live read sequence against a SUB 2050 on service
`57047866-4794-421b-bacf-68a120b4f339` confirms these response examples:

| Command id | Meaning | Type/status | Payload | Interpreted value | Raw frame |
| --- | --- | --- | --- | --- | --- |
| `0040` | Master volume | `0` / `1` | `2a` | `42` | `c0 00 40 00 01 2a d8 85 c0` |
| `004A` | Preset | `0` / `1` | `01` | `1` | `c0 00 4a 00 01 01 25 27 c0` |
| `004B` | Delay | `0` / `1` | `00 00` | `0` | `c0 00 4b 00 01 00 00 ca a7 c0` |
| `0024` | Subwoofer name | `0` / `1` | `53 55 42 2d 32 30 35 30 00` | `SUB-2050` | `c0 00 24 00 01 53 55 42 2d 32 30 35 30 00 27 88 c0` |
| `0022` | Power mode | `0` / `1` | `01` | `1` | `c0 00 22 00 01 01 f9 36 c0` |
| `0023` | Power threshold | `1` / `0` | `03` | `3` | `c0 00 23 01 00 03 ab c1 c0` |
| `0172` | Auto EQ enabled | `0` / `1` | `01` | `true` | `c0 01 72 00 01 01 26 5c c0` |
| `0170` | Auto EQ calibrated | `0` / `1` | `01` | `true` | `c0 01 70 00 01 01 cb 34 c0` |
| `0001` | Firmware version | `0` / `1` | `32 2e 39 2e 31 32 00` | `2.9.12` | `c0 00 01 00 01 32 2e 39 2e 31 32 00 04 b7 c0` |
| `0002` | Hardware version | `0` / `1` | `34 00` | `4` | `c0 00 02 00 01 34 00 ba e2 c0` |
| `0005` | Model name | `0` / `1` | `53 55 42 2d 32 30 35 30 00` | `SUB-2050` | `c0 00 05 00 01 53 55 42 2d 32 30 35 30 00 4a 5d c0` |
| `01D0` | IP address | `0` / `1` | `4e 41 00` | `NA` | `c0 01 d0 00 01 4e 41 00 52 30 c0` |
| `0004` | Manufacturer name | `0` / `1` | `45 4c 41 43 00` | `ELAC` | `c0 00 04 00 01 45 4c 41 43 00 2b 5e c0` |
| `0152` | LED brightness | `0` / `2` | empty | status-only / unsupported in this state | `c0 01 52 00 02 66 58 c0` |

The `0040` master volume payload was verified by setting the iPad app volume
to `42`, which produced payload `0x2a`.

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

- Determine whether `57047866-4794-421b-bacf-68a120b4f339` appears in
  advertisements or only after broad-scan connection.
- Run targeted live reads for remaining commands and record payload examples.
- Confirm payload endianness for all multi-byte values with live BLE captures.
- Confirm the meanings of command ids `0174`, `0177`, `0021`, and `0175`.
- Determine value ranges and units for volume, delay, power threshold, preset,
  LED brightness, and Auto EQ flags.

## Live Read Capture Workflow

1. Start a local static server from the repository root:
   `python3 -m http.server 8000`.
2. Open `http://localhost:8000/web/` in Chrome or Edge on macOS.
3. Power on the subwoofer and use **Connect**. The browser chooser should show
   devices advertising one of the documented service UUIDs.
4. If the chooser is empty, use **Broad scan**. Some BLE devices expose services
   after connection without advertising their UUIDs in a way Web Bluetooth's
   filtered chooser can match.
5. If Broad scan can select the device but the documented paths do not match,
   inspect the event log for additional APK UUID probes and visible
   characteristic properties. If an extra APK service exposes the known
   characteristic layout, the client treats it as an experimental path.
6. Run the default read sequence first. Optional reads add manufacturer name
   (`0004`) and LED brightness (`0152`).
7. Export the JSON log and compare interpreted values with the iPad app.
8. Record confirmed service path, raw frame examples, and any mismatches here.
