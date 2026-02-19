from typing import List, Dict, Any
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import asyncio
import ollama
import logging

from services.embedding_service import EmbeddingService
from services.llm_service import LLMService

logger = logging.getLogger(__name__)

class DriftDetectionService:
    def __init__(self):
        self.embedding_service = EmbeddingService()
        self.llm_service = LLMService()
        
    async def detect_drift(self, document_id: str) -> List[Dict]:
        """Detect drift for a specific document"""
        try:
            # 1. Extract claims from document
            claims = await self.extract_claims(document_id)
            
            # 2. Get related code and behavior data
            related_code = await self.get_related_code(document_id)
            related_behavior = await self.get_related_behavior(document_id)
            
            # 3. Detect contradictions
            contradictions = []
            for claim in claims:
                claim_contradictions = await self.analyze_claim(claim, related_code, related_behavior)
                contradictions.extend(claim_contradictions)
            
            logger.info(f"Detected {len(contradictions)} contradictions for document {document_id}")
            return contradictions
            
        except Exception as e:
            logger.error(f"Failed to detect drift for document {document_id}: {e}")
            raise
    
    async def extract_claims(self, document_id: str) -> List[Dict]:
        """Extract verifiable claims from document"""
        try:
            # Get document content (mock for now)
            document_content = await self.get_document_content(document_id)
            
            prompt = f"""
            Extract technical claims from this documentation:
            {document_content}
            
            Focus on claims about:
            - API behavior (idempotency, async, thread safety)
            - Error handling guarantees
            - Consistency and reliability
            - Performance characteristics
            
            Return as structured claims with confidence scores.
            """
            
            response = await self.llm_service.generate(prompt)
            return self.parse_claims(response)
            
        except Exception as e:
            logger.error(f"Failed to extract claims from document {document_id}: {e}")
            raise
    
    async def analyze_claim(self, claim: Dict, code_data: List[Dict], behavior_data: List[Dict]) -> List[Dict]:
        """Analyze a single claim against code and behavior"""
        contradictions = []
        
        # Generate embedding for claim
        claim_embedding = await self.embedding_service.generate_embedding(claim["statement"])
        
        # Compare with code
        for code in code_data:
            code_embedding = await self.embedding_service.generate_embedding(code["content"])
            similarity = cosine_similarity([claim_embedding], [code_embedding])[0][0]
            
            if similarity < 0.3:  # Low similarity indicates potential contradiction
                contradiction = await self.analyze_contradiction(claim, code, "code")
                if contradiction:
                    contradictions.append(contradiction)
        
        # Compare with behavior
        for behavior in behavior_data:
            behavior_embedding = await self.embedding_service.generate_embedding(behavior["content"])
            similarity = cosine_similarity([claim_embedding], [behavior_embedding])[0][0]
            
            if similarity < 0.3:
                contradiction = await self.analyze_contradiction(claim, behavior, "behavior")
                if contradiction:
                    contradictions.append(contradiction)
        
        return contradictions
    
    async def analyze_contradiction(self, claim: Dict, reality: Dict, source_type: str) -> Dict:
        """Analyze specific contradiction"""
        try:
            prompt = f"""
            Analyze this potential contradiction:
            
            Documentation Claim: {claim["statement"]}
            Reality ({source_type}): {reality["content"]}
            
            Is this a genuine contradiction? If so:
            1. Explain why it's a contradiction
            2. Assess the severity (critical, risky, informational)
            3. Suggest what should be done
            
            Return as JSON with fields: is_contradiction, explanation, severity, recommendation.
            """
            
            response = await self.llm_service.generate(prompt)
            analysis = self.parse_contradiction_analysis(response)
            
            if analysis.get("is_contradiction", False):
                return {
                    "claim": claim["statement"],
                    "reality": reality["content"],
                    "source_type": source_type,
                    "explanation": analysis.get("explanation", ""),
                    "severity": analysis.get("severity", "informational"),
                    "recommendation": analysis.get("recommendation", ""),
                    "confidence": min(claim.get("confidence", 0.8), 0.9)
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Failed to analyze contradiction: {e}")
            return None
    
    async def get_document_content(self, document_id: str) -> str:
        """Get document content from database"""
        # Mock implementation - in real system, query database
        return """
        # Payment API Documentation
        
        ## Features
        - **Idempotent**: All payment operations are fully idempotent
        - **Async**: Non-blocking payment processing
        - **Thread-safe**: Safe for concurrent requests
        - **99.9% Uptime**: High availability guarantee
        """
    
    async def get_related_code(self, document_id: str) -> List[Dict]:
        """Get related code for document"""
        # Mock implementation - in real system, query code database
        return [
            {
                "id": "code_001",
                "content": """
                class PaymentProcessor:
                    def process_payment(self, payment_data):
                        payment_id = generate_payment_id()
                        
                        # Race condition here!
                        if not self.payment_exists(payment_id):
                            with db.transaction():
                                payment = Payment.create(payment_id, payment_data)
                                self.charge_payment_method(payment)  # Blocking call!
                                payment.status = "completed"
                        
                        return {"payment_id": payment_id}
                """,
                "file_path": "/services/payment/payment_processor.py",
                "function": "process_payment"
            }
        ]
    
    async def get_related_behavior(self, document_id: str) -> List[Dict]:
        """Get related behavior data"""
        # Mock implementation - in real system, query logs/incidents
        return [
            {
                "id": "behavior_001",
                "content": "ERROR: Race condition detected in payment processing",
                "source": "application_logs",
                "timestamp": "2024-01-15T10:30:00Z",
                "severity": "error"
            }
        ]
    
    def parse_claims(self, llm_response: str) -> List[Dict]:
        """Parse claims from LLM response"""
        # Mock implementation - in real system, parse JSON response
        return [
            {
                "id": "claim_001",
                "statement": "All payment operations are fully idempotent",
                "confidence": 0.95,
                "entities": ["payment_operations", "idempotent"]
            },
            {
                "id": "claim_002",
                "statement": "Non-blocking payment processing",
                "confidence": 0.90,
                "entities": ["payment_processing", "non_blocking"]
            }
        ]
    
    def parse_contradiction_analysis(self, llm_response: str) -> Dict:
        """Parse contradiction analysis from LLM response"""
        # Mock implementation - in real system, parse JSON response
        return {
            "is_contradiction": True,
            "explanation": "Documentation claims idempotency but code has race conditions",
            "severity": "critical",
            "recommendation": "Fix race conditions and update documentation"
        }
