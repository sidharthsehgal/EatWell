# EatWise AI Architecture

Below is the visual architecture diagram for the EatWise AI application. 

```mermaid
graph TD
    %% Styling
    classDef user fill:#e1f5fe,stroke:#039be5,stroke-width:2px,color:#000
    classDef frontend fill:#fff3e0,stroke:#fb8c00,stroke-width:2px,color:#000
    classDef backend fill:#e8f5e9,stroke:#43a047,stroke-width:2px,color:#000
    classDef external fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px,color:#000
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
        App_State[User Profile / Allergies State]:::backend
        
        subgraph Agents
            AudioAgent[Gemini Live Agent websocket]:::backend
            VisionAgent[Gemini Vision Agent REST]:::backend
        end
    end

    %% External APIs & Services
    subgraph ExternalServices [External Services]
        GeminiLive[Google Gemini Multimodal Live API]:::google
        VertexVision[Google Gemini Pro Vision API]:::google
        OFF[Open Food Facts API]:::external
    end

    %% Connections - User Interaction
    User -- "Speaks/Listens" --> Mic
    User -- "Uploads Product/Label" --> Camera
    User -- "Types Text" --> UI

    %% Connections - Frontend to Backend
    UI -- "REST (Allergies/Profile)" --> API
    Camera -- "REST POST (Image/Barcode)" --> API
    Mic -- "PCM Audio Stream" --> WS_Client
    WS_Client -- "WebSocket wss://" --> AudioAgent

    %% Connections - Backend to External
    AudioAgent -- "Bidirectional gRPC/WS (API Key)\nAudio In/Out, Text" --> GeminiLive
    VisionAgent -- "REST POST (Image bytes)\nIngredient Analysis" --> VertexVision
    
    %% Barcode Flow
    API -- "1. Extract Barcode from Image" --> VisionAgent
    VisionAgent -. "2. Barcode Number" .-> API
    API -- "3. Lookup Product" --> OFF
    OFF -. "4. Product Ingredients" .-> API
    API -- "5. Analyze Ingredients" --> VisionAgent
    VisionAgent -. "6. Safe/Unsafe Verdict" .-> API
    API -. "7. Show to User" .-> UI

    %% Live Audio Barcode Flow (Agent-driven)
    GeminiLive -. "Agent sees/hears barcode\nOutputs: [BARCODE_LOOKUP: X]" .-> AudioAgent
    AudioAgent -- "Tool execution" --> OFF
    OFF -. "Product Info" .-> AudioAgent
    AudioAgent -- "Injects product info back into session" --> GeminiLive
```

## Component Breakdown

1. **Frontend (React / Vite) hosted on Cloud Run via Nginx**:
   - **`useGeminiLive` Hook**: Manages the `AudioContext`, converting the microphone's 16kHz audio into binary PCM chunks and streaming them directly over a secure WebSocket (`wss://`) to your backend.
   - **UI Components**: Collects user dietary restrictions (allergies, vegan, etc.) and handles manual image/barcode uploads.

2. **Backend (FastAPI) hosted on Cloud Run via Uvicorn**:
   - **`main.py` (API Gateway)**: Handles standard REST requests (like barcode scanning and ingredient label processing) using standard HTTP POST methods.
   - **`agent.py` (Live Voice Agent)**: Manages the WebSocket connection from the frontend. It takes the incoming audio/video/text, wraps it in the `google-genai` SDK formats, and establishes a secondary, real-time connection to Google's Gemini server.
   - **`vision.py` & `tools.py`**: Helper modules that make standard REST API calls to Gemini Vision (for reading labels) or the Open Food Facts API (to look up barcode numbers).

3. **External Services**:
   - **Gemini Multimodal Live API**: The core voice model (`gemini-2.5-flash-native-audio-preview`) that listens to the user, understands context, and speaks back in sub-second latency. Connects using your API Key.
   - **Gemini Pro Vision API**: Used as a one-off tool to extract text from labels and barcode numbers from images.
   - **Open Food Facts API**: A free, open database of food products. The backend queries this whenever the user scans a barcode (or when the Voice Agent explicitly requests a barcode lookup).
