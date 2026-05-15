# ELAC SUB Control Reverse Engineering

This repository documents static reverse engineering notes for the Android
ELAC SUB Control 2.0 companion app, with the goal of identifying the Bluetooth
protocol used by an ELAC SUB 2050 subwoofer.

The original APK is intentionally not tracked in git. Place it in the project
root when reproducing the analysis.

## Current Status

The APK has been statically inspected with `androguard`. The app uses BLE GATT,
not Bluetooth Classic. The main protocol details are in
[docs/protocol-notes.md](docs/protocol-notes.md), with process notes in
[Journal.md](Journal.md).

A read-only Web Bluetooth diagnostic client is available in
[web/](web/). It connects to the physical subwoofer from Chrome or Edge,
confirms which documented GATT path is present, sends query packets only, and
exports decoded traffic as JSON for later analysis.

## Goals

- Identify how the Android app discovers and connects to compatible subwoofers.
- Extract Bluetooth service, characteristic, command, and packet-format details.
- Document enough of the protocol to build or test an independent controller.

## Local Tooling

This repo uses a small `uv` Python environment for APK inspection:

```sh
uv sync
.venv/bin/androguard apkid "Elac SUB Control 2 0_v0.0.22_apkpure.com.apk"
```

Generated decompiler output belongs in ignored `decompiled*` folders.

The reusable packet helpers are in `scripts/elac_protocol.py`.

## Web Bluetooth Read Client

Serve the repository over localhost and open the client in Chrome or Edge:

```sh
python3 -m http.server 8000
```

Then visit <http://localhost:8000/web/>. Web Bluetooth requires a secure
context; `localhost` counts, but opening `web/index.html` directly from disk
does not.

The client is intentionally read-only. It writes BLE query frames with command
type `0` to the subwoofer's write characteristic and does not expose command
type `1` setters. Use **Export log** after a run to save raw frames, decoded
packets, selected service UUIDs, browser metadata, and timestamps.

Use **Connect** first. If Chrome's chooser is empty, try **Broad scan**; that
mode lists nearby BLE devices without requiring the ELAC service UUID to appear
in the advertisement, but it still only attempts the documented ELAC GATT
services after a device is selected. If those documented services are missing,
the event log probes additional UUID strings found in the APK and lists visible
characteristics for any matching service. If an extra APK service exposes one
of the known write/notify characteristic layouts, the client promotes it to an
experimental path and allows the read sequence.

Live testing with a SUB 2050 has confirmed service
`57047866-4794-421b-bacf-68a120b4f339` with write characteristic
`c6a0486f-71b5-4226-9057-bf2baa8334e8` and notify characteristic
`116bd560-2c1b-4769-b07d-85e36fc5e086`.

Protocol JavaScript tests can be run with:

```sh
node web/protocol.test.mjs
```

## Legal And Practical Notes

This repository is for interoperability and preservation research. Do not commit
or redistribute ELAC's APK, decompiled source, or other proprietary binary
artifacts.
