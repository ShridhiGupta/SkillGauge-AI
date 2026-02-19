import ollama
import asyncio
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class LLMService:
    def __init__(self):
        self.model = os.getenv('OLLAMA_MODEL', 'llama3')
        self.base_url = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
        
    async def generate(self, prompt: str, max_tokens: int = 1000) -> str:
        """Generate text using local LLM"""
        try:
            # Use asyncio to run blocking ollama call in thread pool
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, 
                lambda: ollama.generate(
                    model=self.model,
                    prompt=prompt,
                    options={
                        'temperature': 0.1,
                        'top_p': 0.9,
                        'max_tokens': max_tokens
                    }
                )
            )
            
            return response['response']
            
        except Exception as e:
            logger.error(f"Failed to generate LLM response: {e}")
            raise
    
    async def embed(self, text: str) -> list:
        """Generate embedding using local LLM"""
        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: ollama.embeddings(
                    model=self.model,
                    prompt=text
                )
            )
            
            return response['embedding']
            
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            raise
    
    async def chat(self, messages: list) -> str:
        """Chat with LLM using message format"""
        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: ollama.chat(
                    model=self.model,
                    messages=messages
                )
            )
            
            return response['message']['content']
            
        except Exception as e:
            logger.error(f"Failed to chat with LLM: {e}")
            raise
    
    def health_check(self) -> bool:
        """Check if LLM service is healthy"""
        try:
            models = ollama.list()
            return self.model in [model['name'] for model in models['models']]
        except Exception as e:
            logger.error(f"LLM health check failed: {e}")
            return False
