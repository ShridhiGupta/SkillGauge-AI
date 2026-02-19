from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

from api.routes.analysis import router as analysis_router
from api.routes.detection import router as detection_router
from api.routes.scoring import router as scoring_router
from services.embedding_service import EmbeddingService
from services.drift_detection_service import DriftDetectionService
from services.scoring_service import ScoringService

app = FastAPI(
    title="SkillGauge AI",
    description="AI engine for detecting knowledge drift",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analysis_router, prefix="/api/analyze")
app.include_router(detection_router, prefix="/api/detect")
app.include_router(scoring_router, prefix="/api/score")

# Initialize services
embedding_service = EmbeddingService()
drift_detection_service = DriftDetectionService()
scoring_service = ScoringService()

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": "2024-01-01T00:00:00Z",
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    return {
        "message": "AI Knowledge Drift Detector Engine",
        "version": "1.0.0",
        "endpoints": {
            "analyze": "/api/analyze",
            "detect": "/api/detect", 
            "score": "/api/score"
        }
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
