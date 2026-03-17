from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

from agent import stream_gemini_audio
from vision import process_ingredient_label
from tools import extract_barcode_ingredients

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket client connected.")
    try:
        await stream_gemini_audio(websocket)
    except Exception as e:
        print(f"WebSocket endpoint error: {e}")
    finally:
        print("WebSocket endpoint closing.")

@app.post("/scan-label")
async def scan_label(file: UploadFile = File(...), allergies: str = Form("")):
    # Use Vertex AI Vision to read ingredients and check them
    content = await file.read()
    result = process_ingredient_label(content, allergies, file.content_type)
    return {"result": result}
    
@app.post("/scan-barcode")
async def scan_barcode(barcode: str = Form(...), allergies: str = Form("")):
    # Use Open Food Facts to fetch ingredients
    ingredients = extract_barcode_ingredients(barcode)
    if not ingredients:
         return {"result": "Could not find ingredients for this barcode."}
    
    # Process the ingredients against allergies using Gemini
    result = process_ingredient_label(ingredients.encode(), allergies, "text/plain", is_text=True)
    return {"result": result}
