# ConstructViz AI

## Overview

ConstructViz AI is a professional material visualization tool for construction and design. It enables users to overlay building materials (flooring, wall coverings, paint, furniture) onto photos of real spaces using AI-powered image generation. The application provides real-time visualization, room analysis, cost estimation, and quote generation for construction projects.

Key capabilities:
- AI-powered material overlay on user photos using Google Gemini models
- Virtual staging for furniture placement
- Room geometry and lighting analysis
- Cinematic video generation using Veo
- Material quantity calculation and cost estimation
- Shopping cart with PDF quote generation

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 19 with TypeScript
- **Styling**: Tailwind CSS (loaded via CDN)
- **Build Tool**: Vite 6 with React plugin
- **Module System**: ES Modules with bundler resolution

The frontend is a single-page application with view-based navigation controlled by an `AppView` enum. State management uses React's built-in useState/useEffect hooks without external state libraries.

### Backend Architecture
- **Runtime**: Node.js with Express 5
- **Language**: TypeScript executed via tsx
- **API Pattern**: RESTful endpoints under `/api` prefix
- **Development**: Concurrent server and Vite dev server using `concurrently`

The backend serves as a thin API layer for database operations and settings management. In production, it also serves the built static files.

### Database
- **Database**: PostgreSQL via `pg` library
- **Connection**: Uses `DATABASE_URL` environment variable
- **Schema**: Includes `app_settings` table for key-value configuration storage

### AI Integration
- **Provider**: Google Generative AI (@google/genai)
- **Models Used**:
  - `gemini-2.5-flash` for room analysis
  - `gemini-3-pro-image-preview` for high-fidelity material texturing
  - `veo-3.1-generate-preview` for video generation
- **API Key Resolution**: Checks localStorage for custom key, falls back to environment variable `API_KEY` or `GEMINI_API_KEY`

### Development Configuration
- **Dev Server Port**: 5000 (Vite frontend)
- **API Server Port**: 3001 (Express backend in development)
- **Proxy**: Vite proxies `/api` requests to the Express server
- **Path Aliases**: `@/*` maps to project root

### Data Models
Materials and contractors are defined with rich schemas supporting:
- Dimensions, pricing, and technical specifications
- Installation types: ROLL, TILE, LINEAR
- Category-based organization with Interior/Exterior usage flags

## External Dependencies

### Email Service
- **Nodemailer**: Gmail SMTP for sending quote request emails
- Sender: configured via `SMTP_USER` and `SMTP_PASS` environment variables
- Receiver: configured via `QUOTE_RECEIVER_EMAIL` environment variable
- Endpoint: `POST /api/send-quote-email` sends formatted quote emails with material details

### AI Services
- **Google Generative AI**: Primary AI service for image generation, analysis, and video creation
- Requires API key with permissions for Gemini 2.5/3.0 and Veo models

### Database
- **PostgreSQL**: Persistent storage for application settings
- Connection via `DATABASE_URL` environment variable

### Browser APIs
- **Camera Access**: Required for capturing room photos via MediaDevices API
- **Canvas API**: Used for image capture from video stream

### CDN Resources
- **Tailwind CSS**: Loaded from cdn.tailwindcss.com
- **Google Fonts**: Inter font family