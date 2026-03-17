import os
import certifi
from google import genai
from google.genai import types

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()


def _get_client():
    """Get a genai client (reuse the same logic as agent.py)."""
    from agent import get_vertex_client
    return get_vertex_client()


def extract_barcode_ingredients(barcode: str) -> str:
    """
    Look up a product by barcode number using Gemini with Google Search grounding.
    Returns product name, brand, and full ingredient list.
    """
    try:
        client = _get_client()
        print(f"[TOOL] Looking up barcode {barcode} via Gemini + Google Search...")

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=(
                f"Look up the product with barcode number {barcode}. "
                "Return the product name, brand, and the complete ingredient list. "
                "If you cannot find the exact product, say so clearly. "
                "Format: Product: <name> | Brand: <brand> | Ingredients: <full list>"
            ),
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            )
        )

        result = response.text
        print(f"[TOOL] Barcode {barcode} result: {result[:150]}...")
        return result

    except Exception as e:
        print(f"[TOOL] ❌ Error looking up barcode: {e}")
        return f"Error looking up barcode {barcode}: {str(e)}"
