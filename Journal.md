# Reverse Engineering Journal

## 2026-05-15

- Workspace initially contained only `Elac SUB Control 2 0_v0.0.22_apkpure.com.apk`.
- Added repository scaffolding and `.gitignore` rules so APKs and decompiled
  artifacts are not tracked.
- Starting with static analysis of the APK metadata, resources, bytecode, and
  string constants to locate Bluetooth protocol details.
- Initialized a git repository and added a local `uv` environment with
  `androguard` for APK parsing/decompilation. The APK itself remains ignored.
- APK metadata:
  - Package: `com.sonavox.elacsubs`
  - Version code/name: `25` / `0.0.22`
  - Min/target SDK: `21` / `29`
  - Declared permissions: Bluetooth, Bluetooth admin, record audio, coarse/fine
    location.
  - SHA-256:
    `182d19128b6dd44a8791e2e42b9ba20081f1484116e3555886527c1a68532c2c`
- Static string and decompiled-code analysis shows the app uses BLE GATT:
  `BluetoothLeScanner`, `ScanFilter`, `connectGatt`, `BluetoothGattCallback`,
  `setCharacteristicNotification`, `writeDescriptor`, and `writeCharacteristic`.
- Decompilation focus:
  - `com.sonavox.elacsubs.b.b`: BLE scanning setup.
  - `com.sonavox.elacsubs.data.a.b`: supported service UUIDs.
  - `com.sonavox.elacsubs.data.a.a`: GATT connection/write/read handling.
  - `com.sonavox.elacsubs.data.a.e`: command packet encode/decode/framing.
- Confirmed supported service UUIDs:
  - `4719bb98-1515-4f2b-a0c1-35b860d52170`
  - `49535343-fe7d-4ae5-8fa9-9fafd205e455`
- For the `49535343-fe7d-...` service, the app writes to and enables
  indications on characteristic `49535343-1e4d-4bd9-ba61-23c647249616`.
  For the other supported service path it writes to
  `c6a0486f-71b5-4226-9057-bf2baa8334e8` and enables notifications on
  `116bd560-2c1b-4769-b07d-85e36fc5e086`.
- Identified packet framing:
  - Start/end byte: `0xC0`
  - Escape byte: `0xDB`
  - Escaped `0xC0`: `0xDB 0xDC`
  - Escaped `0xDB`: `0xDB 0xDD`
  - Inner packet: command id, type, status, payload, CRC-16.
- Added `scripts/elac_protocol.py` to encode/decode the packet format without
  copying APK code. Smoke-tested a sample master-volume write frame:
  `c0 00 40 01 00 4b a0 03 c0`.
- Added a static read-only Web Bluetooth client under `web/` for live testing
  with Chrome/Edge. It discovers the documented GATT service paths, enables
  notifications/indications, sends command type `0` query packets only, decodes
  responses with the independent CRC/framing implementation, and exports JSON
  logs for later protocol notes or emulator fixtures.
- Live Chrome broad-scan testing can select `SUB-2050`, but the device does not
  expose the two documented service UUIDs to Web Bluetooth. One extra APK UUID
  service exposed characteristic `c6a0486f-71b5-4226-9057-bf2baa8334e8` as
  writable, so the web client now probes extra APK UUIDs and can promote a
  matching write/notify characteristic layout to an experimental path.
- Confirmed the live SUB 2050 GATT service path:
  `57047866-4794-421b-bacf-68a120b4f339`, write
  `c6a0486f-71b5-4226-9057-bf2baa8334e8`, notify
  `116bd560-2c1b-4769-b07d-85e36fc5e086`. A read/query run produced repeated
  valid `0023` responses with payload `03`, so the web client now sends the read
  sequence one command at a time and waits for a matching response or timeout.
- Targeted read of master volume is confirmed. Sent
  `c0 00 40 00 00 1d ad c0`; received `c0 00 40 00 01 2a d8 85 c0`, decoded as
  command `0040`, type `0`, status `1`, payload `2a`. The sub was set to volume
  42, confirming direct one-byte volume encoding for this value.
- Full read sequence with optional fields succeeded. Confirmed live values:
  preset `1`, delay `0`, name/model `SUB-2050`, power mode `1`, power threshold
  `3`, auto EQ enabled/calibrated `1`, firmware `2.9.12`, hardware `4`, IP
  string `NA`, manufacturer `ELAC`. LED brightness command `0152` returned
  type `0`, status `2`, empty payload.
- Extended the Web Bluetooth client with Read and Write tabs. The Write tab can
  send command type `1` packets, with master volume `0040` available directly
  and other known write commands guarded by browser confirmation plus readback.
