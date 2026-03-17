import base64
import os
import re
import certifi
import httpx
from google import genai
from google.genai import types

import asyncio
from fastapi import WebSocket, WebSocketDisconnect

from tools import extract_barcode_ingredients

# Force standard CA bundle only for local dev (TLS interception).
# On Cloud Run, the default certs work fine.
if not os.environ.get("K_SERVICE"):  # K_SERVICE is set automatically on Cloud Run
    os.environ["SSL_CERT_FILE"] = certifi.where()
    os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()


def get_vertex_client():
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION")
    api_key = os.environ.get("GEMINI_API_KEY")
    
    if project and location:
        return genai.Client(vertexai=True, project=project, location=location)
    elif api_key:
        return genai.Client(api_key=api_key)
    else:
        raise ValueError("Missing Google Cloud Project or Gemini API Key")

# Regex to detect barcode lookup requests from the agent's text output
BARCODE_PATTERN = re.compile(r"\[BARCODE_LOOKUP:\s*(\d+)\]")

SYSTEM_INSTRUCTION = """
You are a real-time dietary restriction and allergy checker AI assistant.
Your goal is to evaluate food items against user-provided dietary restrictions to determine if they are safe to consume.

CAPABILITIES:
- You can understand audio/voice input.
- You can see and analyze images sent to you (product photos, ingredient labels, barcodes).
- You can receive typed text input from the user containing product names, descriptions, or product page URLs.
- You can request a barcode lookup by including the special tag [BARCODE_LOOKUP: <number>] in your text output. The system will intercept this, look up the product, and provide you with the result.

CONVERSATIONAL FLOW:
1. **Listen for Profile**: Listen to the user describe their allergies or dietary restrictions. Acknowledge and remember these throughout the session.
2. **Pure Audio Queries**: The user may ask about a food item purely through voice ("Can I eat a Snickers bar?"). Use your knowledge to cross-reference with their profile.
3. **Text Input Queries**: The user may type a product name (e.g. "Nutella"), a product description, or a URL to a product page. When you see a message tagged [USER TEXT INPUT], use your knowledge of that product's typical ingredients to evaluate safety. If the input is a URL, try to identify the product from the URL and assess it.
4. **Image Handling**: The user may send you an image. It could be:
   - A product photo: Identify the product and use your knowledge to assess safety.
   - An ingredient label: Read the text on the label and cross-reference with the user's profile.
   - A barcode: Read the barcode number from the image, tell the user you see a barcode, then output the text [BARCODE_LOOKUP: <number>] with the number you read. The system will automatically look it up and provide the result.
5. **Spoken Barcodes**: The user may say a barcode number out loud. Tell the user you're looking it up, then output [BARCODE_LOOKUP: <number>]. The system will provide the result.
6. **Narrate Your Actions**: Always tell the user what you're doing. For example:
   - "I see an ingredient label, let me read it..."
   - "I see a barcode, let me look up the product..."
   - "Looking up that barcode now..."
   - "You typed Nutella, let me check that for you..."
7. **Image Ordering**: The user may upload an image BEFORE or AFTER telling you what to do with it. Either way, process it as soon as you have both the image and context. If the user said they'd upload an image but nothing arrives after about 10 seconds, politely ask them to share it.
8. **Proactive Verdict**: Always output a clear "safe" or "unsafe" verdict with brief reasoning.
9. **Keep it Looping**: After each verdict, ask if they'd like to check another item.

IMPORTANT: When you need to look up a barcode, you MUST include the exact tag [BARCODE_LOOKUP: <number>] in your response text. The system monitors for this tag and will automatically perform the lookup and feed the result back to you. After outputting this tag, wait for the system to provide the product information before giving your verdict.

CRITICAL GUARDRAIL: Stay strictly on topic about food, ingredients, and dietary restrictions. If asked about anything else, politely decline and steer back to food safety. Be brief, professional, and friendly.
"""


async def stream_gemini_audio(websocket: WebSocket):
    try:
        print("Initializing Gemini Live Client...")
        client = get_vertex_client()
        model_name = "gemini-2.5-flash-native-audio-preview-12-2025"
        
        print(f"Connecting to Gemini Live API with model: {model_name}")
        config = types.LiveConnectConfig(
            system_instruction=types.Content(parts=[types.Part.from_text(text=SYSTEM_INSTRUCTION)]),
            response_modalities=["AUDIO"]
        )
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print("✅ Connected to Gemini Live session successfully!")
            
            # --- Send to Gemini ---
            async def receive_from_ws():
                chunk_count = 0
                try:
                    while True:
                        data = await websocket.receive_json()
                        if "bytes" in data:
                            audio_bytes = bytes(data["bytes"])
                            chunk_count += 1
                            if chunk_count % 50 == 1:
                                print(f"[SEND] 🎤 Audio chunk #{chunk_count} ({len(audio_bytes)} bytes)")
                            await session.send(
                                input=types.LiveClientRealtimeInput(
                                    media_chunks=[types.Blob(data=audio_bytes, mime_type="audio/pcm")]
                                )
                            )
                        elif "image" in data:
                            print(f"[SEND] 📷 Image received ({len(data['image'])} chars base64)")
                            image_bytes = base64.b64decode(data["image"])
                            await session.send(
                                input=types.LiveClientRealtimeInput(
                                    media_chunks=[types.Blob(data=image_bytes, mime_type="image/jpeg")]
                                )
                            )
                        elif "text" in data:
                            print(f"[SEND] 💬 User Text: {data['text']}")
                            await session.send(
                                input=types.LiveClientContent(
                                    turns=[types.Content(
                                        role="user",
                                        parts=[types.Part.from_text(text=data['text'])]
                                    )],
                                    turn_complete=True
                                )
                            )
                except WebSocketDisconnect:
                    print("[SEND] Client disconnected.")
                except Exception as e:
                    print(f"[SEND] ❌ Error: {e}")

            # --- Receive from Gemini ---
            async def receive_from_gemini():
                try:
                    while True:
                        print("[RECV] Waiting for next Gemini turn...")
                        turn_text_buffer = ""  # Accumulate text parts to scan for barcode tags
                        
                        async for response in session.receive():
                            server_content = response.server_content
                            if server_content:
                                if server_content.interrupted:
                                    print("[RECV] ⚡ Interruption detected.")
                                    await websocket.send_json({"type": "interrupted"})
                                    turn_text_buffer = ""
                                    continue

                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.executable_code or part.code_execution_result:
                                            continue
                                        if part.inline_data:
                                            print(f"[RECV] 🔊 Audio: {len(part.inline_data.data)} bytes")
                                            await websocket.send_bytes(part.inline_data.data)
                                        elif part.text:
                                            print(f"[RECV] 💬 Text: {part.text}")
                                            turn_text_buffer += part.text

                                if server_content.turn_complete:
                                    print("[RECV] ✅ Turn complete.")
                                    
                                    # Check if agent requested a barcode lookup
                                    matches = BARCODE_PATTERN.findall(turn_text_buffer)
                                    if matches:
                                        for barcode in matches:
                                            print(f"[BARCODE] 🔍 Agent requested lookup for: {barcode}")
                                            result = extract_barcode_ingredients(barcode)
                                            if not result:
                                                result = f"No product information found for barcode {barcode}."
                                            print(f"[BARCODE] ✅ Result: {result[:150]}...")
                                            
                                            # Inject the result back into the session
                                            await session.send(
                                                input=types.LiveClientContent(
                                                    turns=[types.Content(
                                                        role="user",
                                                        parts=[types.Part.from_text(
                                                            text=f"[BARCODE_RESULT for {barcode}]: {result}"
                                                        )]
                                                    )],
                                                    turn_complete=True
                                                )
                                            )
                                            print(f"[BARCODE] Injected result back into session.")
                                    
                                    turn_text_buffer = ""
                        # session.receive() ended (turn_complete), loop back
                except Exception as e:
                    print(f"[RECV] ❌ Error: {e}")
                    import traceback
                    traceback.print_exc()

            await asyncio.gather(receive_from_ws(), receive_from_gemini())
            
    except Exception as e:
        print(f"CRITICAL Live API error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.close()
        except:
             pass
