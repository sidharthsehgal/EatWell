import os
import asyncio
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

async def test_live():
    # Force AI studio
    client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'), http_options={'api_version': 'v1alpha'})
    model_name = "gemini-2.0-flash-exp"
    print(f"Testing {model_name} with v1alpha...")
    try:
        async with client.aio.live.connect(model=model_name) as session:
            print("Connected successfully!")
    except Exception as e:
        print(f"Error v1alpha {model_name}: {e}")
        
    client2 = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))
    model_name2 = "gemini-2.0-flash"
    print(f"\nTesting {model_name2} with default api_version...")
    try:
        async with client2.aio.live.connect(model=model_name2) as session:
            print("Connected successfully!")
    except Exception as e:
        print(f"Error default {model_name2}: {e}")

if __name__ == "__main__":
    asyncio.run(test_live())
