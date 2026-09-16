const $ = (id) => document.getElementById(id);
const orb = $("orb");
const statusEl = $("status");
const txEl = $("transcript");
const activityEl = $("activity");
const connBadge = $("connBadge");
const talkBtn = $("talk");

const BARGE_RMS = 0.02;
let ws, audioCtx, workletNode, micStream;
let nextStart = 0;
let activeSources = [];
let speaking = false;
let started = false;

function setOrb(state) {
  orb.className = "orb " + state;
}
function setStatus(text) {
  statusEl.textContent = text;
}
function setConnection(connected) {
  connBadge.textContent = connected ? "● Connected" : "● Not connected";
  connBadge.className = connected ? "badge live" : "badge";
}
function clearEmptyState(container) {
  const empty = container.querySelector(".empty");
  if (empty) empty.remove();
}
function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function addLine(role, text) {
  clearEmptyState(txEl);
  const wrap = document.createElement("div");
  wrap.className = `bubble ${role}`;
  wrap.innerHTML = `
    <div class="meta">
      <span>${role === "agent" ? "DevOps Assistant" : "You"}</span>
      <span>${timestamp()}</span>
    </div>
    <p></p>
  `;
  wrap.querySelector("p").textContent = text;
  txEl.appendChild(wrap);
  txEl.scrollTop = txEl.scrollHeight;
}
function addActivity(item) {
  clearEmptyState(activityEl);
  const card = document.createElement("div");
  const ok = item.ok !== false;
  card.className = "activity-card";
  const cmd = item.command ? `<div class="command">${escapeHtml(item.command)}</div>` : "";
  const details = item.details ? `<div class="footer-note" style="margin-top:10px;">${escapeHtml(item.details)}</div>` : "";
  card.innerHTML = `
    <div class="meta">
      <span>${escapeHtml(item.title || item.name || "Tool execution")}</span>
      <span>${timestamp()}</span>
    </div>
    <div class="activity-status ${ok ? "" : "error"}">${ok ? "Read-only tool completed" : "Tool returned an error"}</div>
    <p style="margin-top:10px;">${escapeHtml(item.summary || "Completed")}</p>
    ${cmd}
    ${details}
  `;
  activityEl.appendChild(card);
  activityEl.scrollTop = activityEl.scrollHeight;
}
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function playVoice(buf) {
  const int16 = new Int16Array(buf);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
  const ab = audioCtx.createBuffer(1, f32.length, 24000);
  ab.getChannelData(0).set(f32);
  const src = audioCtx.createBufferSource();
  src.buffer = ab;
  src.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  if (nextStart < now) nextStart = now;
  src.start(nextStart);
  nextStart += ab.duration;
  activeSources.push(src);
  src.onended = () => {
    activeSources = activeSources.filter((s) => s !== src);
    if (!activeSources.length) {
      speaking = false;
      setOrb("listening");
      setStatus("Listening for your next question...");
    }
  };
  speaking = true;
  setOrb("speaking");
  setStatus("Assistant is responding...");
}
function stopVoice() {
  activeSources.forEach((s) => { try { s.stop(); } catch {} });
  activeSources = [];
  nextStart = 0;
  speaking = false;
  setOrb("listening");
  setStatus("Listening...");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    setConnection(true);
    setStatus("Live session connected. Speak now.");
    setOrb("listening");
    talkBtn.textContent = "● Live session active";
    talkBtn.disabled = true;
  };
  ws.onclose = () => {
    setConnection(false);
    setStatus("Connection dropped. Refresh the page to start again.");
    setOrb("idle");
  };
  ws.onmessage = (evt) => {
    if (typeof evt.data !== "string") {
      playVoice(evt.data);
      return;
    }
    const m = JSON.parse(evt.data);
    if (m.type === "transcript") {
      if (m.role === "user") {
        setOrb("thinking");
        setStatus("Processing your request...");
        addLine("you", m.text);
      } else {
        addLine("agent", m.text);
      }
    } else if (m.type === "tool_result") {
      addActivity(m);
    } else if (m.type === "interrupted") {
      stopVoice();
    } else if (m.type === "error") {
      addActivity({ title: "Application error", ok: false, summary: m.message });
      setStatus("Error occurred. Check logs or try again.");
    }
  };
}

async function startMic() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.audioWorklet.addModule("/pcm-processor.js");
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const source = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
  workletNode.port.onmessage = (e) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
    if (e.data.rms >= BARGE_RMS && speaking) stopVoice();
  };
  source.connect(workletNode);
  workletNode.connect(audioCtx.destination);
}

async function go() {
  if (started) return;
  started = true;
  talkBtn.disabled = true;
  talkBtn.textContent = "Initializing...";
  setStatus("Preparing microphone and real-time session...");
  setOrb("thinking");
  try {
    await startMic();
    connect();
  } catch (err) {
    started = false;
    talkBtn.disabled = false;
    talkBtn.textContent = "🎙 Start Live Session";
    setOrb("idle");
    setStatus("Could not start. Check browser microphone permissions.");
    addActivity({ title: "Startup error", ok: false, summary: err.message || String(err) });
    console.error(err);
  }
}

talkBtn.addEventListener("click", go);
document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    setStatus(`Suggested prompt: “${btn.dataset.prompt}” — speak it after starting the session.`);
  });
});
