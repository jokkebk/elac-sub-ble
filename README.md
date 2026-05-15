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

## Legal And Practical Notes

This repository is for interoperability and preservation research. Do not commit
or redistribute ELAC's APK, decompiled source, or other proprietary binary
artifacts.
