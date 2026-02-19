from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import asyncio
import uvicorn
from contextlib import asynccontextmanager
import logging
from datetime import datetime

# Import our AI modules
from services.question_generator import QuestionGenerator
from services.response_analyzer import ResponseAnalyzer
from services.scoring_engine import ScoringEngine
from services.llm_interface import LLMInterface
from services.originality_detector import OriginalityDetector
from services.skill_inflation_detector import SkillInflationDetector
from models.schemas import (
    QuestionRequest,
    QuestionResponse,
    AnalysisRequest,
    AnalysisResponse,
    FinalEvaluationRequest,
    FinalEvaluationResponse
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global AI service instances
question_generator: QuestionGenerator = None
response_analyzer: ResponseAnalyzer = None
scoring_engine: ScoringEngine = None
llm_interface: LLMInterface = None
originality_detector: OriginalityDetector = None
skill_inflation_detector: SkillInflationDetector = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting AI Engine initialization...")
    
    global question_generator, response_analyzer, scoring_engine
    global llm_interface, originality_detector, skill_inflation_detector
    
    try:
        # Initialize LLM interface
        llm_interface = LLMInterface()
        await llm_interface.initialize()
        
        # Initialize AI services
        question_generator = QuestionGenerator(llm_interface)
        response_analyzer = ResponseAnalyzer(llm_interface)
        scoring_engine = ScoringEngine()
        originality_detector = OriginalityDetector()
        skill_inflation_detector = SkillInflationDetector()
        
        logger.info("AI Engine initialized successfully")
        
        yield
        
    except Exception as e:
        logger.error(f"Failed to initialize AI Engine: {str(e)}")
        raise
    
    # Shutdown
    logger.info("Shutting down AI Engine...")

# Create FastAPI app
app = FastAPI(
    title="SkillGauge AI Engine",
    description="AI-powered interview integrity and skill verification engine",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    """Check the health of the AI engine and its dependencies"""
    try:
        llm_status = await llm_interface.health_check() if llm_interface else False
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "services": {
                "llm_interface": "healthy" if llm_status else "unhealthy",
                "question_generator": "healthy" if question_generator else "unhealthy",
                "response_analyzer": "healthy" if response_analyzer else "unhealthy",
                "scoring_engine": "healthy" if scoring_engine else "unhealthy"
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        raise HTTPException(status_code=503, detail="Service unavailable")

@app.post("/ai/generate-question", response_model=QuestionResponse, tags=["Questions"])
async def generate_question(request: QuestionRequest):
    """Generate adaptive interview questions based on context"""
    try:
        if not question_generator:
            raise HTTPException(status_code=503, detail="Question generator not initialized")
        
        question = await question_generator.generate_question(
            context=request.context,
            question_type=request.questionType,
            focus_area=request.focusArea
        )
        
        return QuestionResponse(
            success=True,
            data=question
        )
        
    except Exception as e:
        logger.error(f"Question generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate question: {str(e)}")

@app.post("/ai/analyze-response", response_model=AnalysisResponse, tags=["Analysis"])
async def analyze_response(request: AnalysisRequest):
    """Analyze candidate response for authenticity and skill verification"""
    try:
        if not response_analyzer:
            raise HTTPException(status_code=503, detail="Response analyzer not initialized")
        
        # Perform comprehensive analysis
        analysis_tasks = [
            response_analyzer.analyze_technical_depth(request.question, request.response),
            originality_detector.detect_originality(request.response.text),
            response_analyzer.check_consistency(request.response.text, request.candidateContext),
            skill_inflation_detector.detect_inflation(request.response.text, request.candidateContext.claimedSkills)
        ]
        
        # Run analyses in parallel
        technical_depth, originality, consistency, skill_inflation = await asyncio.gather(*analysis_tasks)
        
        # Calculate composite scores
        scores = scoring_engine.calculate_response_scores({
            "technical_depth": technical_depth,
            "originality": originality,
            "consistency": consistency,
            "skill_inflation": skill_inflation
        })
        
        # Generate follow-up suggestions
        follow_up_suggestions = await question_generator.generate_follow_up_suggestions(
            request.response.text,
            scores,
            request.candidateContext
        )
        
        # Identify red flags
        red_flags = scoring_engine.identify_red_flags(scores, {
            "originality": originality,
            "skill_inflation": skill_inflation,
            "consistency": consistency
        })
        
        return AnalysisResponse(
            success=True,
            data={
                "scores": scores,
                "skillInflation": skill_inflation,
                "followUpSuggestions": follow_up_suggestions,
                "redFlags": red_flags
            }
        )
        
    except Exception as e:
        logger.error(f"Response analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to analyze response: {str(e)}")

@app.post("/ai/final-evaluation", response_model=FinalEvaluationResponse, tags=["Evaluation"])
async def final_evaluation(request: FinalEvaluationRequest):
    """Generate final interview evaluation and recommendation"""
    try:
        if not scoring_engine:
            raise HTTPException(status_code=503, detail="Scoring engine not initialized")
        
        # Aggregate all response scores
        aggregated_scores = scoring_engine.aggregate_interview_scores(request.allResponses)
        
        # Calculate final Skill Authenticity Index
        sai = scoring_engine.calculate_skill_authenticity_index(aggregated_scores)
        
        # Generate recommendation
        recommendation = scoring_engine.generate_recommendation(sai, aggregated_scores)
        
        # Verify claimed skills
        skill_verification = scoring_engine.verify_claimed_skills(
            request.candidateProfile.claimedSkills,
            request.allResponses
        )
        
        # Generate detailed report
        detailed_report = {
            "skillVerification": skill_verification,
            "redFlags": scoring_engine.compile_interview_red_flags(request.allResponses),
            "interviewSummary": scoring_engine.generate_interview_summary(aggregated_scores, recommendation)
        }
        
        return FinalEvaluationResponse(
            success=True,
            data={
                "finalScores": aggregated_scores,
                "recommendation": recommendation,
                "detailedReport": detailed_report
            }
        )
        
    except Exception as e:
        logger.error(f"Final evaluation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate final evaluation: {str(e)}")

@app.post("/ai/generate-followup", tags=["Questions"])
async def generate_followup_questions(
    currentResponse: str,
    analysis: Dict[str, Any],
    interviewContext: Dict[str, Any]
):
    """Generate follow-up questions based on current response and analysis"""
    try:
        if not question_generator:
            raise HTTPException(status_code=503, detail="Question generator not initialized")
        
        follow_up_questions = await question_generator.generate_follow_up_suggestions(
            currentResponse,
            analysis,
            interviewContext
        )
        
        return {
            "success": True,
            "data": {
                "questions": follow_up_questions
            }
        }
        
    except Exception as e:
        logger.error(f"Follow-up generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate follow-up questions: {str(e)}")

# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {str(exc)}")
    return HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
