# Building Innovation - ConstructViz AI

A professional material visualization tool for construction and design, featuring real-time AI overlays using Google Gemini 2.5/3.0 and Veo.

## Features

*   **Real-time Visualization**: Overlay flooring, wall coverings, and paint onto user photos.
*   **Virtual Staging**: Place furniture (Sofas, Tables) into empty spaces using AI.
*   **AI Design Consultant**: Analyzes room geometry and lighting to suggest styles.
*   **Cinematic Video Reveal**: Generates 4K video pans of the designed room using the Veo model.
*   **Smart Estimation**: Calculates material quantities for Rolls, Tiles, Linear meters, and Units.
*   **Shopping Cart & Quotes**: Generates professional PDF quotes and email drafts.

## Tech Stack

*   **Frontend**: React 19, TypeScript, Tailwind CSS.
*   **AI Models**:
    *   `gemini-3-pro-image-preview` (High-fidelity texturing)
    *   `gemini-2.5-flash` (Room analysis)
    *   `veo-3.1-generate-preview` (Video generation)
*   **Architecture**: Browser-native ES Modules (via Import Maps).

## Setup

This application is designed to run in an environment where `process.env.API_KEY` is pre-configured with a valid Google GenAI API Key.

### Key Requirements
*   **Camera Access**: Required for capturing room photos.
*   **API Key**: Must have permissions for Gemini 2.5/3.0 and Veo models.

## Usage

1.  **Capture**: Take a photo or upload an image of a room.
2.  **Select Material**: Browse the catalog of Floors, Walls, and Furniture.
3.  **Visualize**: The AI will overlay the material onto the photo, respecting perspective and lighting.
4.  **Estimate**: Calculate the required quantity and cost.
