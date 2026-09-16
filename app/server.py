"""FastAPI + Gemini Live backend for DevOps Shack VoiceOps Assistant."""

import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import types

from app.persona import DEVOPS_SHACK_INSTRUCTION
from app.tools import TOOL_DECLARATIONS, dispatch_tool

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("devops-shack-voiceops")

MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
VOICE = os.getenv("LIVE_VOICE", "Aoede")

client = genai.Client()

LIVE_CONFIG = {
    "response_modalities": ["AUDIO"],
    "system_instruction": DEVOPS_SHACK_INSTRUCTION,
    "input_audio_transcription": {},
    "output_audio_transcription": {},
    "speech_config": {
        "voice_config": {
            "prebuilt_voice_config": {"voice_name": VOICE}
        }
    },
    "tools": [{"function_declarations": TOOL_DECLARATIONS}],
}

app = FastAPI(title="DevOps Shack VoiceOps Assistant", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "application": "DevOps Shack VoiceOps Assistant",
        "model": MODEL,
        "voice": VOICE,
    }


@app.websocket("/ws")
async def voice_socket(websocket: WebSocket):
    await websocket.accept()
    log.info("Browser connected; opening Gemini Live session (model=%s, voice=%s)", MODEL, VOICE)

    try:
        async with client.aio.live.connect(model=MODEL, config=LIVE_CONFIG) as session:
            async def upstream():
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        return
                    raw = message.get("bytes")
                    if raw:
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=raw,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )

            async def handle(response):
                server_content = getattr(response, "server_content", None)
                tool_call = getattr(response, "tool_call", None)

                if server_content is not None:
                    input_tx = getattr(server_content, "input_transcription", None)
                    output_tx = getattr(server_content, "output_transcription", None)
                    model_turn = getattr(server_content, "model_turn", None)

                    if input_tx and getattr(input_tx, "text", None):
                        await websocket.send_text(json.dumps({
                            "type": "transcript",
                            "role": "user",
                            "text": input_tx.text,
                        }))

                    if output_tx and getattr(output_tx, "text", None):
                        await websocket.send_text(json.dumps({
                            "type": "transcript",
                            "role": "assistant",
                            "text": output_tx.text,
                        }))

                    if model_turn and getattr(model_turn, "parts", None):
                        for part in model_turn.parts:
                            inline_data = getattr(part, "inline_data", None)
                            if inline_data and getattr(inline_data, "data", None):
                                await websocket.send_bytes(inline_data.data)

                    if getattr(server_content, "interrupted", None):
                        await websocket.send_text(json.dumps({"type": "interrupted"}))

                if tool_call:
                    responses = []
                    for call in tool_call.function_calls:
                        args = dict(getattr(call, "args", None) or {})
                        event, result = dispatch_tool(call.name, args)
                        await websocket.send_text(json.dumps({"type": "tool_result", **event}))
                        responses.append(types.FunctionResponse(
                            id=call.id,
                            name=call.name,
                            response=result,
                        ))
                    await session.send_tool_response(function_responses=responses)

            async def downstream():
                # receive() completes per response turn; re-enter it for the next turn.
                empty_receives = 0
                while True:
                    received = 0
                    async for response in session.receive():
                        received += 1
                        await handle(response)
                    if received:
                        empty_receives = 0
                    else:
                        empty_receives += 1
                        if empty_receives >= 2:
                            return

            up = asyncio.create_task(upstream(), name="browser-to-gemini")
            down = asyncio.create_task(downstream(), name="gemini-to-browser")
            done, pending = await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)

            for task in done:
                if not task.cancelled() and task.exception():
                    raise task.exception()
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    except WebSocketDisconnect:
        log.info("Browser disconnected")
    except Exception as exc:
        log.exception("Voice session failed")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": f"{type(exc).__name__}: {exc}",
            }))
        except Exception:
            pass


FRONTEND = ROOT / "frontend"
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
