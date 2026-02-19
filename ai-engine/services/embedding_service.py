import numpy as np
from typing import List, Dict, Any
import asyncio
import ollama
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
import logging

logger = logging.getLogger(__name__)

class EmbeddingService:
    def __init__(self):
        self.embedding_model = None
        self.vector_client = None
        self.collection = None
        
    async def initialize(self):
        """Initialize embedding service"""
        try:
            # Initialize sentence transformer model
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            
            # Initialize ChromaDB
            self.vector_client = chromadb.HttpClient(
                host=os.getenv('CHROMA_HOST', 'localhost'),
                port=int(os.getenv('CHROMA_PORT', 8000))
            )
            
            # Get or create collection
            try:
                self.collection = self.vector_client.get_collection("document_embeddings")
            except:
                self.collection = self.vector_client.create_collection(
                    name="document_embeddings",
                    metadata={"hnsw:space": "cosine"}
                )
                
            logger.info("Embedding service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize embedding service: {e}")
            raise
    
    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text"""
        try:
            if not self.embedding_model:
                await self.initialize()
                
            # Generate embedding
            embedding = self.embedding_model.encode(text)
            
            # Convert to list for JSON serialization
            return embedding.tolist()
            
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            raise
    
    async def store_embedding(self, doc_id: str, text: str, metadata: Dict[str, Any]) -> str:
        """Store embedding in vector database"""
        try:
            # Generate embedding
            embedding = await self.generate_embedding(text)
            
            # Store in ChromaDB
            self.collection.add(
                embeddings=[embedding],
                documents=[text],
                metadatas=[{
                    "document_id": doc_id,
                    **metadata
                }],
                ids=[doc_id]
            )
            
            logger.info(f"Stored embedding for document: {doc_id}")
            return doc_id
            
        except Exception as e:
            logger.error(f"Failed to store embedding: {e}")
            raise
    
    async def search_similar(self, query_text: str, n_results: int = 10) -> List[Dict]:
        """Search for similar documents"""
        try:
            # Generate query embedding
            query_embedding = await self.generate_embedding(query_text)
            
            # Search in ChromaDB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=n_results
            )
            
            # Format results
            formatted_results = []
            for i in range(len(results['ids'][0])):
                formatted_results.append({
                    "id": results['ids'][0][i],
                    "document": results['documents'][0][i],
                    "metadata": results['metadatas'][0][i],
                    "distance": results['distances'][0][i]
                })
            
            return formatted_results
            
        except Exception as e:
            logger.error(f"Failed to search similar documents: {e}")
            raise
    
    async def get_document_embedding(self, doc_id: str) -> List[float]:
        """Get embedding for specific document"""
        try:
            results = self.collection.get(
                ids=[doc_id],
                include=["embeddings"]
            )
            
            if results['embeddings']:
                return results['embeddings'][0]
            else:
                return None
                
        except Exception as e:
            logger.error(f"Failed to get document embedding: {e}")
            raise
    
    async def update_embedding(self, doc_id: str, text: str, metadata: Dict[str, Any]):
        """Update existing embedding"""
        try:
            # Delete existing embedding
            self.collection.delete(ids=[doc_id])
            
            # Add new embedding
            await self.store_embedding(doc_id, text, metadata)
            
            logger.info(f"Updated embedding for document: {doc_id}")
            
        except Exception as e:
            logger.error(f"Failed to update embedding: {e}")
            raise
    
    async def delete_embedding(self, doc_id: str):
        """Delete embedding"""
        try:
            self.collection.delete(ids=[doc_id])
            logger.info(f"Deleted embedding for document: {doc_id}")
            
        except Exception as e:
            logger.error(f"Failed to delete embedding: {e}")
            raise
