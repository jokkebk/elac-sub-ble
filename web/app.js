import {
  READ_COMMANDS,
  decodeFrame,
  encodeReadFrame,
  extractSlipFrames,
  hexFromBytes,
  interpretPayload,
} from "./protocol.js";

const SERVICE_PATHS = [
  {
    name: "SUB 2050 live service",
    serviceUuid: "57047866-4794-421b-bacf-68a120b4f339",
    writeUuid: "c6a0486f-71b5-4226-9057-bf2baa8334e8",
    notifyUuid: "116bd560-2c1b-4769-b07d-85e36fc5e086",
  },
  {
    name: "ELAC custom service",
    serviceUuid: "4719bb98-1515-4f2b-a0c1-35b860d52170",
    writeUuid: "c6a0486f-71b5-4226-9057-bf2baa8334e8",
    notifyUuid: "116bd560-2c1b-4769-b07d-85e36fc5e086",
  },
  {
    name: "Microchip transparent UART style service",
    serviceUuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    writeUuid: "49535343-1e4d-4bd9-ba61-23c647249616",
    notifyUuid: "49535343-1e4d-4bd9-ba61-23c647249616",
  },
];

const CHARACTERISTIC_PATHS = [
  {
    name: "ELAC split write/notify characteristics",
    writeUuid: "c6a0486f-71b5-4226-9057-bf2baa8334e8",
    notifyUuid: "116bd560-2c1b-4769-b07d-85e36fc5e086",
  },
  {
    name: "Microchip transparent UART characteristic",
    writeUuid: "49535343-1e4d-4bd9-ba61-23c647249616",
    notifyUuid: "49535343-1e4d-4bd9-ba61-23c647249616",
  },
];

const APK_SERVICE_CANDIDATES = [
  ...SERVICE_PATHS.map((path) => path.serviceUuid),
  "3fa47244-e871-4adf-8a1f-8b02c438926e",
  "8757a6e2-09c1-49be-8251-d5e9b0c1a226",
  "5f317bff-5772-4385-91a8-a2bc7f5cfd2a",
  "bde9606b-e868-4c1e-85b6-4426f4c5c90a",
  "d2846bcd-572b-4d51-9565-447b838d9a04",
];

const els = {
  support: document.querySelector("#support"),
  status: document.querySelector("#status"),
  connect: document.querySelector("#connect"),
  connectAny: document.querySelector("#connect-any"),
  disconnect: document.querySelector("#disconnect"),
  runReads: document.querySelector("#run-reads"),
  includeOptional: document.querySelector("#include-optional"),
  commandSelect: document.querySelector("#command-select"),
  sendSelected: document.querySelector("#send-selected"),
  exportLog: document.querySelector("#export-log"),
  discovered: document.querySelector("#discovered"),
  resultsBody: document.querySelector("#results-body"),
  eventLog: document.querySelector("#event-log"),
};

const state = {
  device: null,
  server: null,
  servicePath: null,
  writeCharacteristic: null,
  notifyCharacteristic: null,
  rxBuffer: new Uint8Array(),
  entries: [],
  sent: [],
  received: [],
  selectedDeviceInfo: null,
  responseWaiters: new Map(),
};

init();

function init() {
  renderSupport();
  renderCommandSelect();
  renderCommandRows();
  els.connect.addEventListener("click", connect);
  els.connectAny.addEventListener("click", connectBroad);
  els.disconnect.addEventListener("click", disconnect);
  els.runReads.addEventListener("click", runReadSequence);
  els.sendSelected.addEventListener("click", sendSelectedRead);
  els.exportLog.addEventListener("click", exportLog);
  window.addEventListener("error", (event) => {
    setStatus(event.message, true);
    logEvent(`Unhandled error: ${event.message}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = event.reason?.message || String(event.reason);
    setStatus(message, true);
    logEvent(`Unhandled promise rejection: ${message}`);
  });
  refreshBluetoothAvailability();
}

function renderSupport() {
  const supported = "bluetooth" in navigator;
  els.support.textContent = supported
    ? "Web Bluetooth is available in this browser."
    : "Web Bluetooth is not available. Use Chrome or Edge on desktop/Android from localhost or HTTPS.";
  els.connect.disabled = !supported;
  els.connectAny.disabled = !supported;
}

async function refreshBluetoothAvailability() {
  if (!("bluetooth" in navigator) || !navigator.bluetooth.getAvailability) {
    return;
  }
  try {
    const available = await navigator.bluetooth.getAvailability();
    logEvent(`Bluetooth adapter availability: ${available ? "available" : "not available"}.`);
    if (!available) {
      setStatus("Chrome can use Web Bluetooth, but the Bluetooth adapter is not currently available.", true);
    }
  } catch (error) {
    logEvent(`Bluetooth availability check failed: ${error.message || error}`);
  }
}

function renderCommandRows() {
  els.resultsBody.replaceChildren();
  for (const command of READ_COMMANDS) {
    const tr = document.createElement("tr");
    tr.dataset.commandId = command.id;
    tr.innerHTML = `
      <td><code>${command.id}</code></td>
      <td>${command.name}${command.optional ? " <span class=\"muted\">optional</span>" : ""}</td>
      <td class="status-cell">Not queried</td>
      <td class="payload-cell"><code></code></td>
      <td class="value-cell"></td>
      <td class="raw-cell"><code></code></td>
    `;
    els.resultsBody.append(tr);
  }
}

function renderCommandSelect() {
  els.commandSelect.replaceChildren();
  for (const command of READ_COMMANDS) {
    const option = document.createElement("option");
    option.value = command.id;
    option.textContent = `${command.id} ${command.name}`;
    if (command.id === "0040") {
      option.selected = true;
    }
    els.commandSelect.append(option);
  }
}

async function connect() {
  setStatus("Opening filtered Bluetooth chooser.");
  await connectWithRequest({
    filters: SERVICE_PATHS.map((path) => ({ services: [path.serviceUuid] })),
    optionalServices: APK_SERVICE_CANDIDATES,
  });
}

async function connectBroad() {
  setStatus("Opening broad Bluetooth chooser.");
  logEvent("Broad scan button clicked.");
  await connectWithRequest({
    acceptAllDevices: true,
    optionalServices: APK_SERVICE_CANDIDATES,
  });
}

async function connectWithRequest(requestOptions) {
  setBusy(true);
  try {
    clearRuntimeState();
    logEvent("Requesting device access from Chrome.");
    state.device = await navigator.bluetooth.requestDevice(requestOptions);
    state.device.addEventListener("gattserverdisconnected", onDisconnected);
    state.selectedDeviceInfo = {
      name: state.device.name || null,
      id: state.device.id || null,
    };
    renderDiscovered();
    els.exportLog.disabled = false;
    logEvent(`Selected ${formatDevice(state.selectedDeviceInfo)}.`);

    state.server = await state.device.gatt.connect();
    logEvent("Connected; discovering services.");
    await selectServicePath();
    await state.notifyCharacteristic.startNotifications();
    state.notifyCharacteristic.addEventListener("characteristicvaluechanged", onNotification);
    setStatus(`Connected through ${state.servicePath.name}.`);
    renderDiscovered();
    els.disconnect.disabled = false;
    els.runReads.disabled = false;
    els.exportLog.disabled = false;
  } catch (error) {
    setStatus(error.message || String(error), true);
    logEvent(`Connection failed: ${error.message || error}`);
    await disconnect({ preserveStatus: true });
  } finally {
    setBusy(false);
  }
}

async function selectServicePath() {
  const attempts = [];
  for (const path of SERVICE_PATHS) {
    try {
      logEvent(`Trying service ${path.serviceUuid}.`);
      const service = await state.server.getPrimaryService(path.serviceUuid);
      logEvent(`Found service ${path.serviceUuid}; checking characteristics.`);
      const writeCharacteristic = await service.getCharacteristic(path.writeUuid);
      const notifyCharacteristic = await service.getCharacteristic(path.notifyUuid);
      state.servicePath = path;
      state.writeCharacteristic = writeCharacteristic;
      state.notifyCharacteristic = notifyCharacteristic;
      logEvent(`Matched ${path.name}: ${path.serviceUuid}.`);
      return;
    } catch (error) {
      const message = `${path.serviceUuid}: ${error.message || error}`;
      attempts.push(message);
      logEvent(`Service path failed: ${message}`);
    }
  }
  const experimentalPath = await probeApkServiceCandidates();
  if (experimentalPath) {
    return;
  }
  throw new Error(`No usable ELAC service path matched. ${attempts.join(" | ")}`);
}

async function probeApkServiceCandidates() {
  const documented = new Set(SERVICE_PATHS.map((path) => path.serviceUuid));
  const extras = APK_SERVICE_CANDIDATES.filter((uuid) => !documented.has(uuid));
  logEvent(`Probing ${extras.length} additional APK UUID candidates.`);
  for (const uuid of extras) {
    try {
      const service = await state.server.getPrimaryService(uuid);
      logEvent(`Additional APK UUID is present as a service: ${uuid}.`);
      await logCharacteristics(service);
      const matched = await tryExperimentalCharacteristicPaths(service);
      if (matched) {
        return matched;
      }
    } catch (error) {
      logEvent(`Additional APK UUID not present: ${uuid}: ${error.message || error}`);
    }
  }
  return null;
}

async function tryExperimentalCharacteristicPaths(service) {
  for (const path of CHARACTERISTIC_PATHS) {
    try {
      logEvent(`Trying ${path.name} on service ${service.uuid}.`);
      const writeCharacteristic = await service.getCharacteristic(path.writeUuid);
      const notifyCharacteristic = await service.getCharacteristic(path.notifyUuid);
      state.servicePath = {
        name: `Experimental APK service using ${path.name}`,
        serviceUuid: service.uuid,
        writeUuid: path.writeUuid,
        notifyUuid: path.notifyUuid,
        experimental: true,
      };
      state.writeCharacteristic = writeCharacteristic;
      state.notifyCharacteristic = notifyCharacteristic;
      logEvent(
        `Matched experimental path: service ${service.uuid}, write ${path.writeUuid}, notify ${path.notifyUuid}.`,
      );
      return state.servicePath;
    } catch (error) {
      logEvent(`Experimental characteristic path failed on ${service.uuid}: ${path.name}: ${error.message || error}`);
    }
  }
  return null;
}

async function logCharacteristics(service) {
  try {
    const characteristics = await service.getCharacteristics();
    if (!characteristics.length) {
      logEvent(`Service ${service.uuid} has no visible characteristics.`);
      return;
    }
    for (const characteristic of characteristics) {
      const props = characteristic.properties;
      const propertyNames = [
        props.read && "read",
        props.write && "write",
        props.writeWithoutResponse && "writeWithoutResponse",
        props.notify && "notify",
        props.indicate && "indicate",
      ].filter(Boolean);
      logEvent(
        `Service ${service.uuid} characteristic ${characteristic.uuid}: ${
          propertyNames.join(", ") || "no common properties"
        }.`,
      );
    }
  } catch (error) {
    logEvent(`Could not list characteristics for ${service.uuid}: ${error.message || error}`);
  }
}

async function disconnect({ preserveStatus = false } = {}) {
  if (state.notifyCharacteristic) {
    state.notifyCharacteristic.removeEventListener("characteristicvaluechanged", onNotification);
    try {
      await state.notifyCharacteristic.stopNotifications();
    } catch {
      // The characteristic may already be disconnected.
    }
  }
  if (state.device?.gatt?.connected) {
    state.device.gatt.disconnect();
  }
  onDisconnected({ preserveStatus });
}

function onDisconnected({ preserveStatus = false } = {}) {
  els.disconnect.disabled = true;
  els.runReads.disabled = true;
  state.server = null;
  state.servicePath = null;
  state.writeCharacteristic = null;
  state.notifyCharacteristic = null;
  if (!preserveStatus) {
    setStatus("Disconnected.");
  }
  setBusy(false);
}

async function runReadSequence() {
  if (!state.writeCharacteristic) {
    setStatus("Connect to the sub before running reads.", true);
    return;
  }
  setBusy(true);
  try {
    const commands = READ_COMMANDS.filter((command) => els.includeOptional.checked || !command.optional);
    logEvent(`Running ${commands.length} read queries.`);
    for (const command of commands) {
      await sendReadCommand(command);
    }
    setStatus("Read sequence finished.");
  } catch (error) {
    setStatus(error.message || String(error), true);
    logEvent(`Read sequence failed: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function sendSelectedRead() {
  if (!state.writeCharacteristic) {
    setStatus("Connect to the sub before sending a read.", true);
    return;
  }
  const command = READ_COMMANDS.find((item) => item.id === els.commandSelect.value);
  if (!command) {
    setStatus("No command selected.", true);
    return;
  }
  setBusy(true);
  try {
    const response = await sendReadCommand(command);
    if (response) {
      setStatus(`Read ${command.id} completed.`);
    } else {
      setStatus(`Read ${command.id} timed out waiting for a matching response.`, true);
    }
  } catch (error) {
    setStatus(error.message || String(error), true);
    logEvent(`Selected read failed: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function sendReadCommand(command) {
  markCommandPending(command.id);
  const frame = encodeReadFrame(command.id);
  const responsePromise = waitForCommandResponse(command.id, 1500);
  await writeFrame(frame);
  state.sent.push({
    at: new Date().toISOString(),
    commandId: command.id,
    commandName: command.name,
    frameHex: hexFromBytes(frame),
  });
  logEvent(`Sent read ${command.id} ${command.name}: ${hexFromBytes(frame)}`);
  const response = await responsePromise;
  if (response) {
    logEvent(`Read ${command.id} completed with payload ${response.payloadHex || "(empty)"}.`);
  } else {
    markCommandTimeout(command.id);
    logEvent(`Read ${command.id} timed out waiting for a matching response.`);
  }
  return response;
}

function waitForCommandResponse(commandId, timeoutMs) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      const waiters = state.responseWaiters.get(commandId) || [];
      const remaining = waiters.filter((waiter) => waiter.resolve !== resolve);
      if (remaining.length) {
        state.responseWaiters.set(commandId, remaining);
      } else {
        state.responseWaiters.delete(commandId);
      }
      resolve(null);
    }, timeoutMs);
    const waiters = state.responseWaiters.get(commandId) || [];
    waiters.push({
      resolve: (entry) => {
        clearTimeout(timeoutId);
        resolve(entry);
      },
    });
    state.responseWaiters.set(commandId, waiters);
  });
}

async function writeFrame(frame) {
  const chunks = chunkBytes(frame, 20);
  for (const chunk of chunks) {
    if (state.writeCharacteristic.writeValueWithoutResponse) {
      await state.writeCharacteristic.writeValueWithoutResponse(chunk);
    } else if (state.writeCharacteristic.writeValueWithResponse) {
      await state.writeCharacteristic.writeValueWithResponse(chunk);
    } else {
      await state.writeCharacteristic.writeValue(chunk);
    }
  }
}

function onNotification(event) {
  const value = event.target.value;
  const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  logEvent(`Received chunk: ${hexFromBytes(bytes)}`);
  state.rxBuffer = concatBytes(state.rxBuffer, bytes);
  const extracted = extractSlipFrames(state.rxBuffer);
  state.rxBuffer = extracted.remainder;
  for (const frame of extracted.frames) {
    handleFrame(frame);
  }
}

function handleFrame(frame) {
  const rawFrame = hexFromBytes(frame);
  try {
    const packet = decodeFrame(frame);
    const payloadHex = hexFromBytes(packet.payload);
    const interpreted = interpretPayload(packet.commandId, packet.payload);
    const entry = {
      at: new Date().toISOString(),
      rawFrame,
      commandId: packet.commandId,
      commandType: packet.commandType,
      status: packet.status,
      payloadHex,
      interpreted,
      crc: `0x${packet.crc.toString(16).padStart(4, "0")}`,
    };
    state.received.push(entry);
    updateCommandRow(entry, "CRC OK");
    resolveCommandWaiters(entry);
    logEvent(`Decoded ${packet.commandId}: type=${packet.commandType} status=${packet.status} payload=${payloadHex}`);
  } catch (error) {
    const entry = {
      at: new Date().toISOString(),
      rawFrame,
      error: error.message || String(error),
    };
    state.received.push(entry);
    logEvent(`Frame decode failed: ${entry.error}; raw=${rawFrame}`);
  }
}

function resolveCommandWaiters(entry) {
  const waiters = state.responseWaiters.get(entry.commandId);
  if (!waiters?.length) {
    return;
  }
  state.responseWaiters.delete(entry.commandId);
  for (const waiter of waiters) {
    waiter.resolve(entry);
  }
}

function updateCommandRow(entry, status) {
  const row = els.resultsBody.querySelector(`tr[data-command-id="${entry.commandId}"]`);
  if (!row) {
    return;
  }
  row.querySelector(".status-cell").textContent = `${status}; type ${entry.commandType}, status ${entry.status}`;
  row.querySelector(".payload-cell code").textContent = entry.payloadHex;
  row.querySelector(".value-cell").textContent = entry.interpreted;
  row.querySelector(".raw-cell code").textContent = entry.rawFrame;
}

function markCommandPending(commandId) {
  const row = els.resultsBody.querySelector(`tr[data-command-id="${commandId}"]`);
  if (!row) {
    return;
  }
  row.querySelector(".status-cell").textContent = "Sent query; waiting";
}

function markCommandTimeout(commandId) {
  const row = els.resultsBody.querySelector(`tr[data-command-id="${commandId}"]`);
  if (!row) {
    return;
  }
  row.querySelector(".status-cell").textContent = "Timed out waiting for response";
}

function exportLog() {
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    bluetoothAvailable: "bluetooth" in navigator,
    device: state.device
      ? {
          name: state.device.name || null,
          id: state.device.id || null,
        }
      : null,
    selectedServicePath: state.servicePath,
    sent: state.sent,
    received: state.received,
    events: state.entries,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `elac-sub-ble-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderDiscovered() {
  if (!state.servicePath) {
    if (state.selectedDeviceInfo) {
      els.discovered.innerHTML = `
        <dl>
          <dt>Selected device</dt><dd>${escapeHtml(formatDevice(state.selectedDeviceInfo))}</dd>
          <dt>GATT path</dt><dd>No documented ELAC service path matched yet.</dd>
        </dl>
      `;
      return;
    }
    els.discovered.textContent = "No service path selected.";
    return;
  }
  els.discovered.innerHTML = `
    <dl>
      <dt>Selected device</dt><dd>${escapeHtml(formatDevice(state.selectedDeviceInfo))}</dd>
      <dt>Service path</dt><dd>${state.servicePath.name}</dd>
      <dt>Service UUID</dt><dd><code>${state.servicePath.serviceUuid}</code></dd>
      <dt>Write characteristic</dt><dd><code>${state.servicePath.writeUuid}</code></dd>
      <dt>Notify/indicate characteristic</dt><dd><code>${state.servicePath.notifyUuid}</code></dd>
    </dl>
  `;
}

function clearRuntimeState() {
  state.rxBuffer = new Uint8Array();
  state.entries = [];
  state.sent = [];
  state.received = [];
  state.selectedDeviceInfo = null;
  state.responseWaiters.clear();
  els.eventLog.replaceChildren();
  renderCommandRows();
  renderDiscovered();
}

function logEvent(message) {
  const entry = { at: new Date().toISOString(), message };
  state.entries.push(entry);
  const li = document.createElement("li");
  li.innerHTML = `<time>${entry.at}</time> ${escapeHtml(message)}`;
  els.eventLog.prepend(li);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function setBusy(isBusy) {
  els.connect.disabled = isBusy || !("bluetooth" in navigator) || Boolean(state.writeCharacteristic);
  els.connectAny.disabled = isBusy || !("bluetooth" in navigator) || Boolean(state.writeCharacteristic);
  els.runReads.disabled = isBusy || !state.writeCharacteristic;
  els.sendSelected.disabled = isBusy || !state.writeCharacteristic;
}

function chunkBytes(bytes, size) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.slice(i, i + size));
  }
  return chunks;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[char];
  });
}

function formatDevice(deviceInfo) {
  if (!deviceInfo) {
    return "unknown device";
  }
  if (deviceInfo.name && deviceInfo.id) {
    return `${deviceInfo.name} (${deviceInfo.id})`;
  }
  return deviceInfo.name || deviceInfo.id || "unnamed device";
}
