import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

try:
    client = genai.Client() # Picks up API key or Vertex from env
    print("Testing get client models...")
    for m in client.models.list():
        if "generateContent" in getattr(m, "supported_actions", []):
            print(f"Model: {m.name}, Actions: {m.supported_actions}")
        if m.name.startswith("gemini-2.0"):
             print(f"Model: {m.name}, Actions: {m.supported_actions}")
except Exception as e:
    import traceback
    traceback.print_exc()
