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
