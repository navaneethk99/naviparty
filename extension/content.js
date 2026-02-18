const state = {
  ws: null,
  serverUrl: null,
  roomId: null,
  isHost: false,
  syncing: false,
  video: null,
  pendingSync: false,
  driftTimer: null,
  status: "disconnected",
};

function setStatus(status) {
  state.status = status;
}

function getStatus() {
  return {
    status: state.status,
    serverUrl: state.serverUrl,
    roomId: state.roomId,
    isHost: state.isHost,
    hasVideo: Boolean(state.video),
  };
}

function safePlay(video) {
  const result = video.play();
  if (result && typeof result.catch === "function") {
    result.catch(() => {});
  }
}

function applyRemoteState(currentTime, isPlaying, onlyIfDrifted) {
  const video = state.video;
  if (!video) return;

  const drift = Math.abs(video.currentTime - currentTime);
  if (onlyIfDrifted && drift <= 1) return;

  state.syncing = true;
  if (Number.isFinite(currentTime)) {
    video.currentTime = currentTime;
  }

  if (isPlaying) {
    safePlay(video);
  } else {
    video.pause();
  }

  setTimeout(() => {
    state.syncing = false;
  }, 500);
}

function send(msg) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(msg));
}

function onLocalPlay() {
  if (state.syncing || !state.isHost) return;
  send({ type: "play", currentTime: state.video.currentTime });
}

function onLocalPause() {
  if (state.syncing || !state.isHost) return;
  send({ type: "pause", currentTime: state.video.currentTime });
}

function onLocalSeeking() {
  if (state.syncing || !state.isHost) return;
  send({ type: "seek", currentTime: state.video.currentTime });
}

function attachVideo(video) {
  if (state.video === video) return;

  if (state.video) {
    state.video.removeEventListener("play", onLocalPlay);
    state.video.removeEventListener("pause", onLocalPause);
    state.video.removeEventListener("seeking", onLocalSeeking);
    state.video.removeEventListener("seeked", onLocalSeeking);
  }

  state.video = video;
  if (!video) return;

  video.addEventListener("play", onLocalPlay);
  video.addEventListener("pause", onLocalPause);
  video.addEventListener("seeking", onLocalSeeking);
  video.addEventListener("seeked", onLocalSeeking);
}

function findVideo() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) return null;
  return videos.find((v) => v.readyState >= 1) || videos[0];
}

function startVideoObserver() {
  const observer = new MutationObserver(() => {
    const next = findVideo();
    if (next) attachVideo(next);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const initial = findVideo();
  if (initial) attachVideo(initial);
}

function startDriftTimer() {
  if (state.driftTimer) clearInterval(state.driftTimer);
  state.driftTimer = setInterval(() => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (!state.video) return;
    if (state.isHost) return;
    state.pendingSync = true;
    send({ type: "sync_request" });
  }, 5000);
}

function connect(serverUrl, roomId) {
  if (!serverUrl || !roomId) return;
  if (state.ws) state.ws.close();

  state.serverUrl = serverUrl;
  state.roomId = roomId;
  state.isHost = false;

  const ws = new WebSocket(serverUrl);
  state.ws = ws;
  setStatus("connecting");

  ws.addEventListener("open", () => {
    setStatus("connected");
    send({ type: "join_room", roomId });
  });

  ws.addEventListener("close", () => {
    setStatus("disconnected");
    state.isHost = false;
  });

  ws.addEventListener("error", () => {
    setStatus("error");
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "joined") {
      state.isHost = Boolean(msg.isHost);
      return;
    }

    if (msg.type === "host") {
      state.isHost = Boolean(msg.isHost);
      return;
    }

    if (msg.type === "state") {
      const onlyIfDrifted = state.pendingSync;
      state.pendingSync = false;
      applyRemoteState(Number(msg.currentTime || 0), Boolean(msg.isPlaying), onlyIfDrifted);
      return;
    }

    if (msg.type === "play") {
      applyRemoteState(Number(msg.currentTime || 0), true, false);
      return;
    }

    if (msg.type === "pause") {
      applyRemoteState(Number(msg.currentTime || 0), false, false);
      return;
    }

    if (msg.type === "seek") {
      applyRemoteState(Number(msg.currentTime || 0), state.video ? !state.video.paused : false, false);
      return;
    }
  });

  startDriftTimer();
}

function disconnect() {
  if (state.ws) state.ws.close();
  state.ws = null;
  setStatus("disconnected");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "connect") {
    connect(msg.serverUrl, msg.roomId);
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "disconnect") {
    disconnect();
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === "get_status") {
    sendResponse(getStatus());
    return true;
  }

  return false;
});

chrome.storage.sync.get(["serverUrl", "roomId"], (res) => {
  if (res.serverUrl && res.roomId) {
    connect(res.serverUrl, res.roomId);
  }
});

startVideoObserver();
startDriftTimer();
