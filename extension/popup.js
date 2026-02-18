const serverInput = document.getElementById("serverUrl");
const roomInput = document.getElementById("roomId");
const statusEl = document.getElementById("status");
const hostEl = document.getElementById("host");
const connectBtn = document.getElementById("connect");
const disconnectBtn = document.getElementById("disconnect");

function updateStatus(status) {
  statusEl.textContent = status.status ? status.status : "Disconnected";
  hostEl.textContent = `Host: ${status.isHost ? "yes" : "no"}`;
  const connected = status.status === "connected";
  connectBtn.style.display = connected ? "none" : "inline-block";
  disconnectBtn.style.display = connected ? "inline-block" : "none";
}

function withActiveTab(fn) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    fn(tab.id);
  });
}

function requestStatus() {
  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "get_status" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res) updateStatus(res);
    });
  });
}

connectBtn.addEventListener("click", () => {
  const serverUrl = serverInput.value.trim();
  const roomId = roomInput.value.trim();
  if (!serverUrl || !roomId) return;

  chrome.storage.sync.set({ serverUrl, roomId });

  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "connect", serverUrl, roomId }, () => {
      if (chrome.runtime.lastError) return;
      requestStatus();
    });
  });
});

disconnectBtn.addEventListener("click", () => {
  withActiveTab((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: "disconnect" }, () => {
      if (chrome.runtime.lastError) return;
      updateStatus({ status: "disconnected", isHost: false });
    });
  });
});

chrome.storage.sync.get(["serverUrl", "roomId"], (res) => {
  if (res.serverUrl) serverInput.value = res.serverUrl;
  if (res.roomId) roomInput.value = res.roomId;
});

requestStatus();
updateStatus({ status: "disconnected", isHost: false });
