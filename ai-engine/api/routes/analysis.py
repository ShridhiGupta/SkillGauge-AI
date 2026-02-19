from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import logging

from services.embedding_service import EmbeddingService
from services.drift_detection_service import DriftDetectionService

router = APIRouter()
logger = logging.getLogger(__name__)

# Initialize services
embedding_service = EmbeddingService()
drift_detection_service = DriftDetectionService()

class DocumentAnalysisRequest(BaseModel):
    document_id: str
    content: str
    metadata: Dict[str, Any]
    analysis_type: List[str] = ["claims", "embeddings", "relationships"]

class DocumentAnalysisResponse(BaseModel):
    success: bool
    data: Optional[Dict] = None
    error: Optional[str] = None

class Claim(BaseModel):
    id: str
    statement: str
    claim_type: str
    confidence: float
    entities: List[str]
    context: str
    position: Dict[str, int]

class Embedding(BaseModel):
    chunk_id: str
    vector: List[float]
    metadata: Dict[str, Any]
    model_version: str

class Relationship(BaseModel):
    source_entity: str
    target_entity: str
    relationship_type: str
    confidence: float
    evidence: str

@router.post("/document", response_model=DocumentAnalysisResponse)
async def analyze_document(request: DocumentAnalysisRequest):
    """Analyze document for claims, embeddings, and relationships"""
    try:
        # Initialize services if needed
        await embedding_service.initialize()
        
        # Initialize result
        result = {
            "document_id": request.document_id,
            "analysis_id": f"analysis_{request.document_id}",
            "claims": [],
            "embeddings": [],
            "relationships": [],
            "confidence_score": 0.0,
            "processing_time": 0.0
        }
        
        # Extract claims
        if "claims" in request.analysis_type:
            claims = await drift_detection_service.extract_claims(request.document_id)
            result["claims"] = claims
        
        # Generate embeddings
        if "embeddings" in request.analysis_type:
            # Split content into chunks
            chunks = split_into_chunks(request.content)
            
            for i, chunk in enumerate(chunks):
                embedding_vector = await embedding_service.generate_embedding(chunk)
                
                embedding = {
                    "chunk_id": f"{request.document_id}_chunk_{i}",
                    "vector": embedding_vector,
                    "metadata": {
                        "document_id": request.document_id,
                        "chunk_index": i,
                        "chunk_length": len(chunk),
                        "model_version": "all-MiniLM-L6-v2"
                    }
                }
                
                result["embeddings"].append(embedding)
                
                # Store in vector database
                await embedding_service.store_embedding(
                    embedding["chunk_id"],
                    chunk,
                    embedding["metadata"]
                )
        
        # Calculate confidence score
        if result["claims"]:
            avg_claim_confidence = sum(claim.get("confidence", 0.5) for claim in result["claims"]) / len(result["claims"])
            result["confidence_score"] = avg_claim_confidence
        
        logger.info(f"Document analysis completed for {request.document_id}")
        
        return DocumentAnalysisResponse(
            success=True,
            data=result
        )
        
    except Exception as e:
        logger.error(f"Document analysis failed: {e}")
        return DocumentAnalysisResponse(
            success=False,
            error=str(e)
        )

@router.post("/code", response_model=DocumentAnalysisResponse)
async def analyze_code(request: DocumentAnalysisRequest):
    """Analyze code for intent and patterns"""
    try:
        # Initialize services if needed
        await embedding_service.initialize()
        
        result = {
            "code_id": request.document_id,
            "analysis_id": f"code_analysis_{request.document_id}",
            "intent": await analyze_code_intent(request.content),
            "patterns": await analyze_code_patterns(request.content),
            "embeddings": [],
            "confidence_score": 0.0
        }
        
        # Generate embeddings for code
        chunks = split_into_chunks(request.content, chunk_size=500)
        
        for i, chunk in enumerate(chunks):
            embedding_vector = await embedding_service.generate_embedding(chunk)
            
            embedding = {
                "chunk_id": f"{request.document_id}_code_chunk_{i}",
                "vector": embedding_vector,
                "metadata": {
                    "document_id": request.document_id,
                    "content_type": "code",
                    "chunk_index": i,
                    "model_version": "all-MiniLM-L6-v2"
                }
            }
            
            result["embeddings"].append(embedding)
        
        logger.info(f"Code analysis completed for {request.document_id}")
        
        return DocumentAnalysisResponse(
            success=True,
            data=result
        )
        
    except Exception as e:
        logger.error(f"Code analysis failed: {e}")
        return DocumentAnalysisResponse(
            success=False,
            error=str(e)
        )

def split_into_chunks(content: str, chunk_size: int = 1000) -> List[str]:
    """Split content into chunks for processing"""
    chunks = []
    for i in range(0, len(content), chunk_size):
        chunk = content[i:i + chunk_size]
        if chunk.strip():
            chunks.append(chunk)
    return chunks

async def analyze_code_intent(code_content: str) -> Dict:
    """Analyze code intent"""
    # Mock implementation - in real system, use AST analysis
    return {
        "functions": [
            {
                "name": "process_payment",
                "is_async": False,
                "has_blocking_io": True,
                "blocking_operations": ["database transactions", "external API calls"],
                "race_conditions": ["payment existence check"],
                "side_effects": ["database writes", "external API calls"]
            }
        ],
        "is_async": False,
        "has_blocking_io": True,
        "is_idempotent": False,
        "thread_safety": "questionable",
        "error_handling": ["try_catch"],
        "dependencies": ["database", "external_api"]
    }

async def analyze_code_patterns(code_content: str) -> Dict:
    """Analyze code patterns"""
    # Mock implementation - in real system, use pattern matching
    return {
        "blocking_operations": [
            {
                "type": "database_transaction",
                "location": "line 15",
                "severity": "medium"
            }
        ],
        "race_conditions": [
            {
                "type": "check_then_act",
                "location": "line 12-14",
                "severity": "high"
            }
        ],
        "non_idempotent_operations": [
            {
                "function": "process_payment",
                "reason": "race condition window"
            }
        ],
        "state_management": {
            "has_shared_state": True,
            "locking_mechanism": "none"
        }
    }
