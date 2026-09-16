const $ = (id) => document.getElementById(id);

const orb = $("orb");
const statusEl = $("status");
const txEl = $("transcript");
const activityEl = $("activity");
const connBadge = $("connBadge");
const talkBtn = $("talk");

const BARGE_RMS = 0.02;

let ws;
let audioCtx;
let workletNode;
let micStream;

let nextStart = 0;
let activeSources = [];
let speaking = false;
let started = false;

// Keep track of the currently streaming transcript bubble
let activeTranscriptBubble = null;
let activeTranscriptRole = null;


/* -------------------------------------------------------
   UI HELPERS
------------------------------------------------------- */

function setOrb(state) {
  orb.className = "orb " + state;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setConnection(connected) {
  connBadge.textContent = connected
    ? "● Connected"
    : "● Not connected";

  connBadge.className = connected
    ? "badge live"
    : "badge";
}

function clearEmptyState(container) {
  const empty = container.querySelector(".empty");

  if (empty) {
    empty.remove();
  }
}

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}


/* -------------------------------------------------------
   TRANSCRIPT
------------------------------------------------------- */

/*
  Gemini Live may send transcript text in multiple chunks.

  Example:

  "I've checked the running"
  "containers, and there"
  "are currently zero"
  "Docker containers running."

  We want ONE chat bubble, not four.
*/

function mergeTranscriptText(current, incoming) {
  current = String(current || "");
  incoming = String(incoming || "");

  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  /*
    Handle cumulative transcription.

    Example:

    current:
      "Docker"

    incoming:
      "Docker containers"

    In this case incoming already contains current.
  */
  if (incoming.startsWith(current)) {
    return incoming;
  }

  /*
    Ignore exact/repeated chunks.
  */
  if (current === incoming || current.endsWith(incoming)) {
    return current;
  }

  /*
    Find overlapping text.

    Example:

    current:
      "Docker containers are"

    incoming:
      "are running"

    Result:
      "Docker containers are running"
  */
  const maxOverlap = Math.min(current.length, incoming.length);

  for (let i = maxOverlap; i > 0; i--) {
    const endOfCurrent = current.slice(-i);
    const startOfIncoming = incoming.slice(0, i);

    if (endOfCurrent === startOfIncoming) {
      return current + incoming.slice(i);
    }
  }

  /*
    Decide whether we need a space between chunks.
  */
  const currentEndsWithSpace = /\s$/.test(current);
  const incomingStartsWithSpace = /^\s/.test(incoming);
  const incomingStartsWithPunctuation =
    /^[,.;!?)}\]]/.test(incoming);

  if (
    currentEndsWithSpace ||
    incomingStartsWithSpace ||
    incomingStartsWithPunctuation
  ) {
    return current + incoming;
  }

  return current + " " + incoming;
}


function addLine(role, text) {
  if (!text) {
    return;
  }

  clearEmptyState(txEl);

  /*
    If the same person is still speaking,
    update the existing bubble.
  */
  if (
    activeTranscriptBubble &&
    activeTranscriptRole === role
  ) {
    const paragraph =
      activeTranscriptBubble.querySelector("p");

    paragraph.textContent = mergeTranscriptText(
      paragraph.textContent,
      text
    );

    txEl.scrollTop = txEl.scrollHeight;

    return;
  }

  /*
    Speaker changed.
    Create a new conversation bubble.
  */
  const wrap = document.createElement("div");

  wrap.className = `bubble ${role}`;

  wrap.innerHTML = `
    <div class="meta">
      <span>
        ${role === "agent"
          ? "DevOps Assistant"
          : "You"}
      </span>

      <span>${timestamp()}</span>
    </div>

    <p></p>
  `;

  wrap.querySelector("p").textContent = text;

  txEl.appendChild(wrap);

  activeTranscriptBubble = wrap;
  activeTranscriptRole = role;

  txEl.scrollTop = txEl.scrollHeight;
}


/* -------------------------------------------------------
   TOOL ACTIVITY
------------------------------------------------------- */

function addActivity(item) {
  clearEmptyState(activityEl);

  const card = document.createElement("div");

  const ok = item.ok !== false;

  card.className = "activity-card";

  const cmd = item.command
    ? `<div class="command">
         ${escapeHtml(item.command)}
       </div>`
    : "";

  const details = item.details
    ? `
      <div
        class="footer-note"
        style="margin-top:10px;"
      >
        ${escapeHtml(item.details)}
      </div>
    `
    : "";

  card.innerHTML = `
    <div class="meta">
      <span>
        ${escapeHtml(
          item.title ||
          item.name ||
          "Tool execution"
        )}
      </span>

      <span>${timestamp()}</span>
    </div>

    <div class="activity-status ${ok ? "" : "error"}">
      ${
        ok
          ? "Read-only tool completed"
          : "Tool returned an error"
      }
    </div>

    <p style="margin-top:10px;">
      ${escapeHtml(
        item.summary || "Completed"
      )}
    </p>

    ${cmd}

    ${details}
  `;

  activityEl.appendChild(card);

  activityEl.scrollTop =
    activityEl.scrollHeight;
}


function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


/* -------------------------------------------------------
   ASSISTANT AUDIO PLAYBACK
------------------------------------------------------- */

function playVoice(buf) {
  const int16 = new Int16Array(buf);

  const f32 = new Float32Array(
    int16.length
  );

  for (
    let i = 0;
    i < int16.length;
    i++
  ) {
    f32[i] =
      int16[i] / 0x8000;
  }

  /*
    Gemini output audio is being played
    as 24 kHz PCM.
  */
  const ab = audioCtx.createBuffer(
    1,
    f32.length,
    24000
  );

  ab
    .getChannelData(0)
    .set(f32);

  const src =
    audioCtx.createBufferSource();

  src.buffer = ab;

  src.connect(
    audioCtx.destination
  );

  const now =
    audioCtx.currentTime;

  if (nextStart < now) {
    nextStart = now;
  }

  src.start(nextStart);

  nextStart += ab.duration;

  activeSources.push(src);

  src.onended = () => {
    activeSources =
      activeSources.filter(
        (s) => s !== src
      );

    if (!activeSources.length) {
      speaking = false;

      setOrb("listening");

      setStatus(
        "Listening for your next question..."
      );
    }
  };

  speaking = true;

  setOrb("speaking");

  setStatus(
    "Assistant is responding..."
  );
}


function stopVoice() {
  activeSources.forEach((source) => {
    try {
      source.stop();
    } catch {}
  });

  activeSources = [];

  nextStart = 0;

  speaking = false;

  setOrb("listening");

  setStatus("Listening...");
}


/* -------------------------------------------------------
   WEBSOCKET CONNECTION
------------------------------------------------------- */

function connect() {
  const proto =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  ws = new WebSocket(
    `${proto}://${location.host}/ws`
  );

  ws.binaryType = "arraybuffer";


  /* Connection opened */

  ws.onopen = () => {
    setConnection(true);

    setStatus(
      "Live session connected. Speak now."
    );

    setOrb("listening");

    talkBtn.textContent =
      "● Live session active";

    talkBtn.disabled = true;
  };


  /* Connection closed */

  ws.onclose = () => {
    setConnection(false);

    setStatus(
      "Connection dropped. Refresh the page to start again."
    );

    setOrb("idle");

    started = false;
  };


  /* Incoming message */

  ws.onmessage = (evt) => {

    /*
      Binary data = assistant voice audio
    */

    if (
      typeof evt.data !== "string"
    ) {
      playVoice(evt.data);
      return;
    }


    /*
      JSON event
    */

    let m;

    try {
      m = JSON.parse(evt.data);
    } catch (error) {
      console.error(
        "Invalid WebSocket message:",
        evt.data
      );

      return;
    }


    /* Transcript */

    if (m.type === "transcript") {

      if (m.role === "user") {

        setOrb("thinking");

        setStatus(
          "Processing your request..."
        );

        addLine(
          "you",
          m.text
        );

      } else {

        addLine(
          "agent",
          m.text
        );

      }

      return;
    }


    /* Tool result */

    if (m.type === "tool_result") {

      addActivity(m);

      return;
    }


    /* User interrupted assistant */

    if (m.type === "interrupted") {

      stopVoice();

      return;
    }


    /* Error */

    if (m.type === "error") {

      addActivity({
        title: "Application error",
        ok: false,
        summary:
          m.message ||
          "Unknown application error",
      });

      setStatus(
        "Error occurred. Check logs or try again."
      );

      return;
    }

  };


  ws.onerror = (error) => {

    console.error(
      "WebSocket error:",
      error
    );

  };
}


/* -------------------------------------------------------
   MICROPHONE
------------------------------------------------------- */

async function startMic() {

  const AudioContextClass =
    window.AudioContext ||
    window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error(
      "Web Audio API is not supported by this browser."
    );
  }


  audioCtx =
    new AudioContextClass();


  /*
    Resume context if browser created it
    in suspended state.
  */

  if (
    audioCtx.state === "suspended"
  ) {
    await audioCtx.resume();
  }


  /*
    Load PCM processor.
  */

  if (!audioCtx.audioWorklet) {
    throw new Error(
      "AudioWorklet is not available. Use localhost or HTTPS."
    );
  }

  await audioCtx.audioWorklet.addModule(
    "/pcm-processor.js"
  );


  /*
    Request microphone.
  */

  micStream =
    await navigator.mediaDevices
      .getUserMedia({

        audio: {

          channelCount: 1,

          echoCancellation: true,

          noiseSuppression: true,

          autoGainControl: true,

        },

      });


  console.log(
    "AudioContext sample rate:",
    audioCtx.sampleRate
  );


  const audioTrack =
    micStream.getAudioTracks()[0];

  if (audioTrack) {
    console.log(
      "Microphone settings:",
      audioTrack.getSettings()
    );
  }


  /*
    Microphone → AudioWorklet
  */

  const source =
    audioCtx.createMediaStreamSource(
      micStream
    );


  workletNode =
    new AudioWorkletNode(
      audioCtx,
      "pcm-processor"
    );


  workletNode.port.onmessage = (e) => {

    /*
      Send PCM audio to backend.
    */

    if (
      ws &&
      ws.readyState ===
        WebSocket.OPEN
    ) {
      ws.send(
        e.data.pcm
      );
    }


    /*
      Barge-in detection.

      If user starts speaking while
      assistant is speaking,
      stop assistant playback.
    */

    if (
      e.data.rms >= BARGE_RMS &&
      speaking
    ) {
      stopVoice();
    }

  };


  source.connect(
    workletNode
  );


  /*
    Required to keep AudioWorklet active
    in some browsers.

    pcm-processor.js should output silence
    so microphone audio is not played back.
  */

  workletNode.connect(
    audioCtx.destination
  );
}


/* -------------------------------------------------------
   START LIVE SESSION
------------------------------------------------------- */

async function go() {

  if (started) {
    return;
  }

  started = true;

  talkBtn.disabled = true;

  talkBtn.textContent =
    "Initializing...";

  setStatus(
    "Preparing microphone and real-time session..."
  );

  setOrb("thinking");


  try {

    await startMic();

    connect();

  } catch (err) {

    started = false;

    talkBtn.disabled = false;

    talkBtn.textContent =
      "🎙 Start Live Session";

    setOrb("idle");


    /*
      Display a more useful error instead
      of always blaming microphone permission.
    */

    if (
      err.name === "NotAllowedError"
    ) {

      setStatus(
        "Microphone permission was denied."
      );

    } else if (
      err.name === "NotFoundError"
    ) {

      setStatus(
        "No microphone was detected."
      );

    } else {

      setStatus(
        "Could not start the live session. Check diagnostics."
      );

    }


    addActivity({

      title: "Startup error",

      ok: false,

      summary:
        err.message ||
        String(err),

    });


    console.error(
      "Startup error:",
      err
    );

  }
}


/* -------------------------------------------------------
   START BUTTON
------------------------------------------------------- */

talkBtn.addEventListener(
  "click",
  go
);


/* -------------------------------------------------------
   SUGGESTED PROMPTS
------------------------------------------------------- */

document
  .querySelectorAll(".chip")
  .forEach((btn) => {

    btn.addEventListener(
      "click",
      () => {

        setStatus(
          `Suggested prompt: “${btn.dataset.prompt}” — speak it after starting the session.`
        );

      }
    );

  });
