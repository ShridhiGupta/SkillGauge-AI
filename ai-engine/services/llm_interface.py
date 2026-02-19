import asyncio
import aiohttp
import json
from typing import Dict, List, Optional, Any
from loguru import logger
import time

class LLMInterface:
    def __init__(self, ollama_url: str = "http://localhost:11434", model: str = "codellama"):
        self.ollama_url = ollama_url
        self.model = model
        self.session = None
        self.is_initialized = False
        
    async def initialize(self):
        """Initialize the LLM interface and verify connection"""
        try:
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=60),
                connector=aiohttp.TCPConnector(limit=10)
            )
            
            # Check if Ollama is running and model is available
            await self._check_ollama_health()
            await self._ensure_model_available()
            
            self.is_initialized = True
            logger.info(f"LLM Interface initialized with model: {self.model}")
            
        except Exception as e:
            logger.error(f"Failed to initialize LLM Interface: {str(e)}")
            raise
    
    async def _check_ollama_health(self):
        """Check if Ollama service is running"""
        try:
            async with self.session.get(f"{self.ollama_url}/api/tags") as response:
                if response.status == 200:
                    logger.info("Ollama service is healthy")
                    return True
                else:
                    raise Exception(f"Ollama returned status: {response.status}")
        except Exception as e:
            raise Exception(f"Cannot connect to Ollama at {self.ollama_url}: {str(e)}")
    
    async def _ensure_model_available(self):
        """Ensure the required model is available in Ollama"""
        try:
            async with self.session.get(f"{self.ollama_url}/api/tags") as response:
                if response.status == 200:
                    data = await response.json()
                    available_models = [model['name'] for model in data.get('models', [])]
                    
                    # Check if our model is available (without version tag)
                    model_available = any(
                        self.model in available_model 
                        for available_model in available_models
                    )
                    
                    if not model_available:
                        logger.warning(f"Model {self.model} not found. Available models: {available_models}")
                        # Try to pull the model
                        await self._pull_model()
                    else:
                        logger.info(f"Model {self.model} is available")
                        
        except Exception as e:
            logger.error(f"Failed to check model availability: {str(e)}")
            raise
    
    async def _pull_model(self):
        """Pull the required model from Ollama"""
        try:
            logger.info(f"Pulling model {self.model}...")
            
            pull_data = {"name": self.model}
            
            async with self.session.post(
                f"{self.ollama_url}/api/pull",
                json=pull_data
            ) as response:
                if response.status == 200:
                    logger.info(f"Successfully pulled model {self.model}")
                else:
                    raise Exception(f"Failed to pull model: {response.status}")
                    
        except Exception as e:
            logger.error(f"Failed to pull model {self.model}: {str(e)}")
            # Try to use a fallback model
            self.model = "llama2"
            logger.info(f"Falling back to model: {self.model}")
    
    async def generate_response(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate response from the LLM"""
        if not self.is_initialized:
            raise Exception("LLM Interface not initialized")
        
        try:
            # Prepare the request
            request_data = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.7,
                    "top_p": 0.9,
                    "max_tokens": 2048,
                    "num_predict": 1024
                }
            }
            
            # Add system prompt if provided
            if system_prompt:
                request_data["system"] = system_prompt
            
            start_time = time.time()
            
            async with self.session.post(
                f"{self.ollama_url}/api/generate",
                json=request_data
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    response_text = result.get("response", "")
                    
                    generation_time = time.time() - start_time
                    logger.info(f"Generated response in {generation_time:.2f}s")
                    
                    return response_text
                else:
                    error_text = await response.text()
                    raise Exception(f"LLM request failed: {response.status} - {error_text}")
                    
        except Exception as e:
            logger.error(f"Failed to generate LLM response: {str(e)}")
            raise
    
    async def generate_structured_response(self, prompt: str, schema: Dict) -> Dict:
        """Generate structured response following a specific schema"""
        try:
            # Add schema instructions to prompt
            schema_prompt = f"""
            Please respond with valid JSON that follows this exact schema:
            {json.dumps(schema, indent=2)}
            
            Your response must be valid JSON and nothing else.
            
            {prompt}
            """
            
            response_text = await self.generate_response(schema_prompt)
            
            # Try to parse as JSON
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                # If direct parsing fails, try to extract JSON from the response
                json_match = self._extract_json_from_text(response_text)
                if json_match:
                    return json.loads(json_match)
                else:
                    # Fallback response
                    logger.warning("Failed to parse structured response, using fallback")
                    return self._generate_fallback_response(schema)
                    
        except Exception as e:
            logger.error(f"Failed to generate structured response: {str(e)}")
            return self._generate_fallback_response(schema)
    
    def _extract_json_from_text(self, text: str) -> Optional[str]:
        """Extract JSON from text that might contain other content"""
        import re
        
        # Look for JSON blocks
        json_patterns = [
            r'```json\s*(.*?)\s*```',
            r'```\s*(.*?)\s*```',
            r'\{.*\}',
        ]
        
        for pattern in json_patterns:
            matches = re.findall(pattern, text, re.DOTALL)
            for match in matches:
                try:
                    json.loads(match.strip())
                    return match.strip()
                except json.JSONDecodeError:
                    continue
        
        return None
    
    def _generate_fallback_response(self, schema: Dict) -> Dict:
        """Generate a fallback response that matches the schema structure"""
        fallback = {}
        
        def generate_fallback_value(value_type):
            if isinstance(value_type, dict):
                return {k: generate_fallback_value(v) for k, v in value_type.items()}
            elif isinstance(value_type, list) and value_type:
                return [generate_fallback_value(value_type[0])]
            elif "score" in str(value_type).lower():
                return 6.0  # Neutral score
            elif "text" in str(value_type).lower() or "string" in str(value_type).lower():
                return "Analysis completed with fallback response"
            else:
                return None
        
        for key, value_type in schema.items():
            fallback[key] = generate_fallback_value(value_type)
        
        return fallback
    
    async def batch_generate(self, prompts: List[str], system_prompt: Optional[str] = None) -> List[str]:
        """Generate responses for multiple prompts in parallel"""
        if not self.is_initialized:
            raise Exception("LLM Interface not initialized")
        
        try:
            tasks = [
                self.generate_response(prompt, system_prompt)
                for prompt in prompts
            ]
            
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Handle exceptions
            processed_responses = []
            for response in responses:
                if isinstance(response, Exception):
                    logger.error(f"Batch generation error: {str(response)}")
                    processed_responses.append("Error generating response")
                else:
                    processed_responses.append(response)
            
            return processed_responses
            
        except Exception as e:
            logger.error(f"Failed to generate batch responses: {str(e)}")
            raise
    
    async def analyze_code(self, code: str, question: str) -> Dict:
        """Analyze code response specifically"""
        try:
            code_analysis_prompt = f"""
            Analyze this code response to the question: {question}
            
            Code:
            ```python
            {code}
            ```
            
            Evaluate:
            1. Correctness (1-10)
            2. Code quality and style (1-10)
            3. Efficiency and performance (1-10)
            4. Edge case handling (1-10)
            5. Best practices adherence (1-10)
            
            Return JSON format:
            {{
                "correctness": <score>,
                "code_quality": <score>,
                "efficiency": <score>,
                "edge_cases": <score>,
                "best_practices": <score>,
                "issues_found": ["issue1", "issue2"],
                "suggestions": ["suggestion1", "suggestion2"],
                "overall_score": <score>
            }}
            """
            
            return await self.generate_structured_response(
                code_analysis_prompt,
                {
                    "correctness": "float",
                    "code_quality": "float",
                    "efficiency": "float",
                    "edge_cases": "float",
                    "best_practices": "float",
                    "issues_found": ["string"],
                    "suggestions": ["string"],
                    "overall_score": "float"
                }
            )
            
        except Exception as e:
            logger.error(f"Failed to analyze code: {str(e)}")
            return {
                "correctness": 5.0,
                "code_quality": 5.0,
                "efficiency": 5.0,
                "edge_cases": 5.0,
                "best_practices": 5.0,
                "issues_found": ["Analysis failed"],
                "suggestions": ["Review code manually"],
                "overall_score": 5.0
            }
    
    async def health_check(self) -> bool:
        """Check if the LLM service is healthy"""
        try:
            if not self.session:
                return False
            
            async with self.session.get(f"{self.ollama_url}/api/tags") as response:
                return response.status == 200
                
        except Exception:
            return False
    
    async def close(self):
        """Close the aiohttp session"""
        if self.session:
            await self.session.close()
            self.session = None
            self.is_initialized = False
            logger.info("LLM Interface closed")

# Context manager for LLM interface
class LLMContext:
    def __init__(self, ollama_url: str = "http://localhost:11434", model: str = "codellama"):
        self.llm_interface = LLMInterface(ollama_url, model)
    
    async def __aenter__(self):
        await self.llm_interface.initialize()
        return self.llm_interface
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.llm_interface.close()
