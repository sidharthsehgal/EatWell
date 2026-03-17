# EatWise AI Architecture

Below is the visual architecture diagram for the EatWise AI application. 

```mermaid
graph TD
    %% Styling
    classDef user fill:#e1f5fe,stroke:#039be5,stroke-width:2px,color:#000
    classDef frontend fill:#fff3e0,stroke:#fb8c00,stroke-width:2px,color:#000
    classDef backend fill:#e8f5e9,stroke:#43a047,stroke-width:2px,color:#000
    classDef google fill:#e8eaf6,stroke:#3f51b5,stroke-width:2px,color:#000

    %% Actors
    User((User)):::user

    %% Frontend Components
    subgraph Client [EatWise AI Frontend]
        UI[React UI / Components]:::frontend
        Mic[Microphone / AudioContext]:::frontend
        Camera[Camera / File Upload]:::frontend
        WS_Client[useGeminiLive WebSocket Hook]:::frontend
    end

    %% Backend Components
    subgraph Server [Google Cloud Run Backend]
        API[FastAPI Gateway]:::backend
        
        subgraph Agents
            AudioAgent[Gemini Live Agent websocket]:::backend
            VisionAgent[Gemini Vision Helper REST]:::backend
        end
    end

    %% External APIs & Services
    subgraph ExternalServices [External Services]
        GeminiLive[Google Gemini Multimodal Live API]:::google
        VertexVision[Google Gemini 2.0/2.5 Flash API]:::google
        GoogleSearch[Google Search Grounding]:::google
    end

    %% Connections - User Interaction
    User -- "Speaks/Listens" --> Mic
    User -- "Uploads Product/Label" --> UI
    User -- "Types Text" --> UI

    %% Connections - Frontend to Backend
    Mic -- "PCM Audio Stream" --> WS_Client
    UI -- "Images / Text (via sendImage/sendText)" --> WS_Client
    WS_Client -- "Single Persistent WebSocket (wss://)" --> AudioAgent

    %% Connections - Backend to External
    AudioAgent -- "Bidirectional gRPC/WS (Gemini Live Session)\nAudio, Video, Text" --> GeminiLive
    
    %% Barcode & Label Processing Flow
    AudioAgent -- "Tool: extract_barcode_ingredients" --> VisionAgent
    VisionAgent -- "Gemini + Google Search" --> GoogleSearch
    GoogleSearch -. "Product Details & Ingredients" .-> VisionAgent
    VisionAgent -. "Full Ingredient List" .-> AudioAgent
    AudioAgent -- "Injects product info back into session" --> GeminiLive
```

## Component Breakdown

1. **Frontend (React / Vite)**:
   - **`useGeminiLive` Hook**: The single point of contact for the backend. It manages the `AudioContext` for voice and packages manual inputs (text, camera captures, and file uploads) to be sent over the **same WebSocket stream**.
   - **UI Components**: Provides the user with a streamlined "Product Lookup" interface, including a camera overlay and text field.

2. **Backend (FastAPI)**:
   - **`agent.py` (The Heart)**: Manages the WebSocket connection from the frontend. It establishes a real-time, bidirectional session with Google's Gemini models. It handles audio chunking, user interruptions, and multimodal tool calling.
   - **`tools.py` (The Researcher)**: A dedicated module used by the agent to perform deep searches. Instead of relying on static databases (like Open Food Facts), it uses **Gemini with Google Search grounding** to find the most accurate and up-to-date ingredient lists for any product or barcode.
   - **`vision.py` (The Analyst)**: Provides specialized vision processing for analyzing ingredient labels when the user uploads a photo.

3. **External Services**:
   - **Gemini Multimodal Live API**: The core "brain" (`gemini-2.5-flash-native-audio-preview`) that maintains the conversation state, understands your diet, and provides the safety verdict.
   - **Google Search Grounding**: Allows the AI to look up millions of products across the web in real-time, ensuring we never have "missing" barcodes.

## Key Flow: The "Unified WebSocket"
Unlike traditional REST-heavy apps, EatWise AI uses a **decoupled WebSocket architecture**. 
- Even when you take a photo or type text, it is sent via the persistent WebSocket connection.
- This allows the Gemini session to "see" your input while it's still "listening" to you, creating a seamless, interruptible voice-and-vision experience.
