import base64
from agent import get_vertex_client

def process_ingredient_label(image_bytes: bytes, allergies: str, mime_type: str, is_text: bool = False) -> str:
    """
    Uses Gemini Vision (via Vertex AI) to read ingredients from an image and check against allergies,
    or process text ingredients directly.
    """
    client = get_vertex_client()
    model_name = "gemini-2.5-flash-native-audio-preview-12-2025"
    
    prompt = f"The user has the following dietary restrictions and allergies: {allergies}\n\n"
    
    if is_text:
        prompt += f"Here are the ingredients for a product: {image_bytes.decode()}\n"
        prompt += "Based on these ingredients, is this product safe for the user to consume? Give a clear 'SAFE' or 'UNSAFE' verdict at the beginning, explain your reasoning, and then ask the user if they want to check another item."
        response = client.models.generate_content(
            model=model_name,
            contents=prompt
        )
    else:
        prompt += "Attached is an image of an ingredient label. Please extract the ingredients from the text on the label. "
        prompt += "Based on these ingredients, is this product safe for the user to consume? Give a clear 'SAFE' or 'UNSAFE' verdict at the beginning, explain your reasoning, and then ask the user if they want to check another item."
        
        # Prepare the inline block for the image
        from google.genai import types
        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        
        response = client.models.generate_content(
            model=model_name,
            contents=[prompt, image_part]
        )
        
    return response.text
