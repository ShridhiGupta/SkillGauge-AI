import asyncio
import re
import numpy as np
from typing import Dict, List, Any, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import nltk
from nltk.tokenize import sent_tokenize, word_tokenize
from nltk.corpus import stopwords
import spacy
from loguru import logger

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

class ResponseAnalyzer:
    def __init__(self, llm_interface):
        self.llm_interface = llm_interface
        self.tfidf_vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.nlp = None
        
        # Load spaCy model asynchronously
        asyncio.create_task(self._load_spacy_model())
    
    async def _load_spacy_model(self):
        """Load spaCy model for NLP tasks"""
        try:
            self.nlp = spacy.load("en_core_web_sm")
            logger.info("SpaCy model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load spaCy model: {str(e)}")
            # Fallback to basic processing
            self.nlp = None
    
    async def analyze_technical_depth(self, question: Dict, response: Dict) -> Dict:
        """Analyze the technical depth of a candidate's response"""
        try:
            response_text = response.get('text', '')
            question_text = question.get('text', '')
            
            # Create analysis prompts
            prompts = {
                "conceptual": f"""
                Analyze the conceptual understanding in this response:
                Question: {question_text}
                Response: {response_text}
                
                Evaluate on a scale of 1-10:
                1. Core concept understanding
                2. Depth of explanation
                3. Connection to related concepts
                4. Practical application knowledge
                
                Provide specific evidence for each score and return JSON format:
                {{
                    "conceptual_understanding": <score>,
                    "depth_explanation": <score>,
                    "concept_connections": <score>,
                    "practical_application": <score>,
                    "evidence": ["specific evidence points"],
                    "reasoning": "detailed reasoning"
                }}
                """,
                
                "implementation": f"""
                Analyze the implementation knowledge:
                Question: {question_text}
                Response: {response_text}
                
                Evaluate on a scale of 1-10:
                1. Technical accuracy
                2. Best practices awareness
                3. Edge case consideration
                4. Scalability/Performance awareness
                
                Return JSON format:
                {{
                    "technical_accuracy": <score>,
                    "best_practices": <score>,
                    "edge_cases": <score>,
                    "scalability": <score>,
                    "evidence": ["specific evidence points"],
                    "reasoning": "detailed reasoning"
                }}
                """
            }
            
            # Get LLM analysis
            conceptual_analysis = await self.llm_interface.generate_response(prompts["conceptual"])
            implementation_analysis = await self.llm_interface.generate_response(prompts["implementation"])
            
            # Parse responses (simplified - in production, use proper JSON parsing)
            conceptual_score = self._extract_llm_score(conceptual_analysis)
            implementation_score = self._extract_llm_score(implementation_analysis)
            
            # Calculate composite technical depth score
            weights = {
                "conceptual_understanding": 0.3,
                "technical_accuracy": 0.25,
                "practical_application": 0.25,
                "advanced_concepts": 0.2
            }
            
            technical_depth = (
                conceptual_score * (weights["conceptual_understanding"] + weights["practical_application"]) +
                implementation_score * (weights["technical_accuracy"] + weights["advanced_concepts"])
            )
            
            return {
                "score": min(10, max(1, technical_depth)),
                "conceptual_analysis": conceptual_analysis,
                "implementation_analysis": implementation_analysis,
                "evidence": self._extract_evidence(conceptual_analysis + implementation_analysis)
            }
            
        except Exception as e:
            logger.error(f"Technical depth analysis failed: {str(e)}")
            return {"score": 5.0, "error": str(e)}
    
    async def check_consistency(self, response_text: str, candidate_context: Dict) -> Dict:
        """Check response consistency with previous answers and claimed skills"""
        try:
            previous_responses = candidate_context.get('previousResponses', [])
            claimed_skills = candidate_context.get('claimedSkills', [])
            
            if not previous_responses:
                # No previous responses to compare with
                return {"score": 8.0, "inconsistencies": [], "reasoning": "First response - no consistency check possible"}
            
            # Analyze consistency with previous responses
            consistency_analysis = await self._analyze_response_consistency(
                response_text, previous_responses
            )
            
            # Check skill claim consistency
            skill_consistency = await self._analyze_skill_consistency(
                response_text, claimed_skills
            )
            
            # Calculate overall consistency score
            consistency_score = (
                consistency_analysis["score"] * 0.6 +
                skill_consistency["score"] * 0.4
            )
            
            return {
                "score": min(10, max(1, consistency_score)),
                "inconsistencies": consistency_analysis.get("inconsistencies", []),
                "skill_mismatches": skill_consistency.get("mismatches", []),
                "reasoning": f"Response consistency: {consistency_analysis['reasoning']}, Skill alignment: {skill_consistency['reasoning']}"
            }
            
        except Exception as e:
            logger.error(f"Consistency check failed: {str(e)}")
            return {"score": 5.0, "error": str(e)}
    
    async def _analyze_response_consistency(self, current_response: str, previous_responses: List[str]) -> Dict:
        """Analyze consistency with previous responses"""
        try:
            # Combine all responses for vectorization
            all_responses = [current_response] + previous_responses
            
            # Create TF-IDF vectors
            tfidf_matrix = self.tfidf_vectorizer.fit_transform(all_responses)
            
            # Calculate similarity between current and previous responses
            current_vector = tfidf_matrix[0:1]
            previous_vectors = tfidf_matrix[1:]
            
            similarities = cosine_similarity(current_vector, previous_vectors)[0]
            avg_similarity = np.mean(similarities)
            
            # Check for contradictions using LLM
            contradiction_prompt = f"""
            Analyze these responses for contradictions:
            
            Current response: {current_response}
            
            Previous responses:
            {chr(10).join([f"{i+1}. {resp}" for i, resp in enumerate(previous_responses)])}
            
            Identify any contradictions and rate consistency on a scale of 1-10.
            Return JSON format:
            {{
                "contradictions": ["contradiction 1", "contradiction 2"],
                "consistency_score": <score>,
                "reasoning": "detailed reasoning"
            }}
            """
            
            contradiction_analysis = await self.llm_interface.generate_response(contradiction_prompt)
            contradictions = self._extract_contradictions(contradiction_analysis)
            llm_score = self._extract_llm_score(contradiction_analysis)
            
            # Combine similarity and contradiction analysis
            final_score = (avg_similarity * 10 * 0.4 + llm_score * 0.6)
            
            return {
                "score": final_score,
                "similarities": similarities.tolist(),
                "avg_similarity": avg_similarity,
                "contradictions": contradictions,
                "reasoning": f"Semantic similarity: {avg_similarity:.2f}, LLM analysis: {llm_score}"
            }
            
        except Exception as e:
            logger.error(f"Response consistency analysis failed: {str(e)}")
            return {"score": 5.0, "error": str(e)}
    
    async def _analyze_skill_consistency(self, response_text: str, claimed_skills: List[str]) -> Dict:
        """Analyze consistency between response and claimed skills"""
        try:
            if not claimed_skills:
                return {"score": 8.0, "mismatches": [], "reasoning": "No claimed skills to verify"}
            
            # Extract technical terms from response
            technical_terms = self._extract_technical_terms(response_text)
            
            # Check alignment with claimed skills
            skill_alignment_prompt = f"""
            Analyze the alignment between this response and claimed skills:
            
            Response: {response_text}
            Claimed skills: {', '.join(claimed_skills)}
            
            Evaluate:
            1. Does the response demonstrate the claimed skills?
            2. Are there any mismatches between claims and demonstrated knowledge?
            3. What is the overall alignment score (1-10)?
            
            Return JSON format:
            {{
                "alignment_score": <score>,
                "demonstrated_skills": ["skill1", "skill2"],
                "missing_skills": ["skill3", "skill4"],
                "mismatches": ["mismatch description"],
                "reasoning": "detailed reasoning"
            }}
            """
            
            alignment_analysis = await self.llm_interface.generate_response(skill_alignment_prompt)
            alignment_score = self._extract_llm_score(alignment_analysis)
            mismatches = self._extract_mismatches(alignment_analysis)
            
            return {
                "score": alignment_score,
                "demonstrated_skills": self._extract_demonstrated_skills(alignment_analysis),
                "missing_skills": self._extract_missing_skills(alignment_analysis),
                "mismatches": mismatches,
                "technical_terms_found": technical_terms,
                "reasoning": f"Skill alignment analysis: {alignment_score}/10"
            }
            
        except Exception as e:
            logger.error(f"Skill consistency analysis failed: {str(e)}")
            return {"score": 5.0, "error": str(e)}
    
    def _extract_technical_terms(self, text: str) -> List[str]:
        """Extract technical terms from response text"""
        if self.nlp:
            doc = self.nlp(text)
            # Extract named entities and technical terms
            entities = [ent.text for ent in doc.ents if ent.label_ in ['ORG', 'PRODUCT', 'TECHNOLOGY']]
            return entities
        else:
            # Fallback: simple keyword extraction
            tech_keywords = [
                'api', 'database', 'algorithm', 'framework', 'library', 'architecture',
                'scalability', 'performance', 'security', 'cloud', 'microservices',
                'react', 'node', 'python', 'java', 'javascript', 'sql', 'nosql'
            ]
            found_terms = []
            for keyword in tech_keywords:
                if keyword.lower() in text.lower():
                    found_terms.append(keyword)
            return found_terms
    
    def _extract_llm_score(self, llm_response: str) -> float:
        """Extract numerical score from LLM response"""
        try:
            # Look for patterns like "score": 7.5 or score: 7.5
            score_patterns = [
                r'"?score"?\s*:\s*([0-9]+\.?[0-9]*)',
                r'([0-9]+\.?[0-9]*)\s*/\s*10',
                r'score.*?([0-9]+\.?[0-9]*)'
            ]
            
            for pattern in score_patterns:
                match = re.search(pattern, llm_response.lower())
                if match:
                    score = float(match.group(1))
                    return min(10, max(1, score))
            
            # Fallback: return default score
            return 6.0
            
        except Exception:
            return 6.0
    
    def _extract_evidence(self, text: str) -> List[str]:
        """Extract evidence points from LLM response"""
        try:
            evidence_pattern = r'"?evidence"?\s*:\s*\[(.*?)\]'
            match = re.search(evidence_pattern, text, re.DOTALL)
            if match:
                evidence_text = match.group(1)
                # Clean up and split by commas
                evidence_items = [item.strip().strip('"\'') for item in evidence_text.split(',')]
                return [item for item in evidence_items if item]
            return []
        except Exception:
            return []
    
    def _extract_contradictions(self, text: str) -> List[str]:
        """Extract contradictions from LLM response"""
        try:
            contradiction_pattern = r'"?contradictions"?\s*:\s*\[(.*?)\]'
            match = re.search(contradiction_pattern, text, re.DOTALL)
            if match:
                contradiction_text = match.group(1)
                contradictions = [item.strip().strip('"\'') for item in contradiction_text.split(',')]
                return [item for item in contradictions if item]
            return []
        except Exception:
            return []
    
    def _extract_mismatches(self, text: str) -> List[str]:
        """Extract skill mismatches from LLM response"""
        try:
            mismatch_pattern = r'"?mismatches"?\s*:\s*\[(.*?)\]'
            match = re.search(mismatch_pattern, text, re.DOTALL)
            if match:
                mismatch_text = match.group(1)
                mismatches = [item.strip().strip('"\'') for item in mismatch_text.split(',')]
                return [item for item in mismatches if item]
            return []
        except Exception:
            return []
    
    def _extract_demonstrated_skills(self, text: str) -> List[str]:
        """Extract demonstrated skills from LLM response"""
        try:
            skill_pattern = r'"?demonstrated_skills"?\s*:\s*\[(.*?)\]'
            match = re.search(skill_pattern, text, re.DOTALL)
            if match:
                skill_text = match.group(1)
                skills = [item.strip().strip('"\'') for item in skill_text.split(',')]
                return [item for item in skills if item]
            return []
        except Exception:
            return []
    
    def _extract_missing_skills(self, text: str) -> List[str]:
        """Extract missing skills from LLM response"""
        try:
            missing_pattern = r'"?missing_skills"?\s*:\s*\[(.*?)\]'
            match = re.search(missing_pattern, text, re.DOTALL)
            if match:
                missing_text = match.group(1)
                missing_skills = [item.strip().strip('"\'') for item in missing_text.split(',')]
                return [item for item in missing_skills if item]
            return []
        except Exception:
            return []
