import math
from typing import Dict, Any
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class ScoringService:
    def __init__(self):
        pass
    
    def calculate_document_freshness_score(self, document: Dict) -> float:
        """Calculate Document Freshness Score (0-100)"""
        try:
            # Base quality assessment
            base_score = self.assess_base_quality(document)
            
            # Freshness component (0-100)
            freshness_score = self.calculate_freshness(document["last_modified"])
            
            # Accuracy component (0-100)
            accuracy_score = self.calculate_accuracy(document)
            
            # Completeness component (0-100)
            completeness_score = self.calculate_completeness(document)
            
            # Temporal decay factor
            decay_factor = self.calculate_temporal_decay(document["last_modified"])
            
            # Weighted calculation
            dfs = (
                base_score * 
                (0.4 * freshness_score + 0.4 * accuracy_score + 0.2 * completeness_score) / 100
            ) * decay_factor
            
            return min(100, max(0, dfs))
            
        except Exception as e:
            logger.error(f"Failed to calculate document freshness score: {e}")
            return 0.0
    
    def calculate_system_knowledge_index(self, documents: list) -> float:
        """Calculate overall System Knowledge Index (0-100)"""
        try:
            total_weighted_score = 0
            total_weight = 0
            
            for doc in documents:
                dfs = self.calculate_document_freshness_score(doc)
                importance = self.get_business_importance(doc)
                usage = self.get_usage_frequency(doc)
                
                weight = importance * usage
                total_weighted_score += dfs * weight
                total_weight += weight
            
            if total_weight == 0:
                return 0
            
            return total_weighted_score / total_weight
            
        except Exception as e:
            logger.error(f"Failed to calculate system knowledge index: {e}")
            return 0.0
    
    def calculate_drift_severity_score(self, drift_alert: Dict) -> float:
        """Calculate Drift Severity Score (0-100)"""
        try:
            # Contradiction strength
            contradiction_strength = self.calculate_contradiction_strength(drift_alert)
            
            # Impact weight
            impact_weight = self.calculate_impact_weight(drift_alert)
            
            # Urgency weight
            urgency_weight = self.calculate_urgency_weight(drift_alert)
            
            # Evidence confidence
            evidence_confidence = drift_alert.get("evidence_confidence", 0.8)
            
            # Calculate DSS
            dss = (
                contradiction_strength * 
                impact_weight * 
                urgency_weight * 
                evidence_confidence
            ) * 100
            
            return min(100, max(0, dss))
            
        except Exception as e:
            logger.error(f"Failed to calculate drift severity score: {e}")
            return 0.0
    
    def assess_base_quality(self, document: Dict) -> float:
        """Assess base quality of document"""
        # Mock implementation - in real system, analyze content quality
        return 85.0
    
    def calculate_freshness(self, last_modified: str) -> float:
        """Calculate freshness score based on recency"""
        try:
            last_modified_date = datetime.fromisoformat(last_modified.replace('Z', '+00:00'))
            days_old = (datetime.utcnow() - last_modified_date).days
            
            # Freshness decay curve
            if days_old <= 7:
                return 100
            elif days_old <= 30:
                return 100 - (days_old - 7) * 1.5  # Linear decay
            elif days_old <= 90:
                return 65 - (days_old - 30) * 0.5  # Slower decay
            else:
                return max(20, 50 - (days_old - 90) * 0.1)  # Minimum floor
                
        except Exception as e:
            logger.error(f"Failed to calculate freshness: {e}")
            return 50.0
    
    def calculate_temporal_decay(self, last_modified: str) -> float:
        """Calculate temporal decay factor for scoring"""
        try:
            last_modified_date = datetime.fromisoformat(last_modified.replace('Z', '+00:00'))
            days_old = (datetime.utcnow() - last_modified_date).days
            
            # Exponential decay with floor
            decay = math.exp(-days_old / 180)  # Half-life of 180 days
            return max(0.3, decay)  # Minimum 30% of original score
            
        except Exception as e:
            logger.error(f"Failed to calculate temporal decay: {e}")
            return 0.5
    
    def calculate_accuracy(self, document: Dict) -> float:
        """Calculate accuracy score"""
        # Mock implementation - in real system, check against drift alerts
        drift_count = document.get("drift_count", 0)
        base_accuracy = 100
        
        # Reduce accuracy based on drift count
        accuracy = base_accuracy - (drift_count * 10)
        return max(0, accuracy)
    
    def calculate_completeness(self, document: Dict) -> float:
        """Calculate completeness score"""
        # Mock implementation - in real system, analyze content completeness
        metadata = document.get("metadata", {})
        
        score = 50  # Base score
        
        # Add points for different sections
        if metadata.get("has_examples"):
            score += 15
        if metadata.get("has_api_documentation"):
            score += 15
        if metadata.get("has_error_handling"):
            score += 10
        if metadata.get("has_performance_notes"):
            score += 10
        
        return min(100, score)
    
    def get_business_importance(self, document: Dict) -> float:
        """Calculate business importance weight (0-1)"""
        importance_factors = {
            "critical_api": 1.0,
            "core_service": 0.9,
            "user_facing": 0.8,
            "internal_tool": 0.6,
            "deprecated": 0.3,
            "reference": 0.4
        }
        
        doc_type = document.get("type", "reference")
        return importance_factors.get(doc_type, 0.5)
    
    def get_usage_frequency(self, document: Dict) -> float:
        """Calculate usage frequency weight (0-1)"""
        # Usage metrics from analytics
        view_count = document.get("view_count", 0)
        last_accessed = document.get("last_accessed", datetime.min)
        
        # Calculate usage score
        days_since_access = (datetime.utcnow() - last_accessed).days
        
        # Frequency decay
        if days_since_access <= 1:
            recency_factor = 1.0
        elif days_since_access <= 7:
            recency_factor = 0.8
        elif days_since_access <= 30:
            recency_factor = 0.5
        else:
            recency_factor = 0.2
        
        # Normalize view count (logarithmic scale)
        view_score = min(1.0, math.log10(view_count + 1) / 5)
        
        return (view_score * 0.7 + recency_factor * 0.3)
    
    def calculate_contradiction_strength(self, drift_alert: Dict) -> float:
        """Calculate semantic contradiction strength (0-1)"""
        contradiction_type = drift_alert.get("type", "")
        
        # Type-based strength mapping
        strength_mapping = {
            "idempotency_violation": 0.9,
            "async_blocking_contradiction": 0.7,
            "thread_safety_violation": 0.95,
            "consistency_violation": 0.85,
            "error_handling_mismatch": 0.6,
            "performance_mismatch": 0.5,
            "api_contract_violation": 0.8
        }
        
        base_strength = strength_mapping.get(contradiction_type, 0.5)
        
        # Adjust based on semantic distance
        semantic_distance = drift_alert.get("semantic_distance", 0.5)
        adjusted_strength = base_strength * (0.7 + 0.3 * semantic_distance)
        
        return min(1.0, adjusted_strength)
    
    def calculate_impact_weight(self, drift_alert: Dict) -> float:
        """Calculate business impact weight (0-1)"""
        # Entity criticality
        entity = drift_alert.get("entity", "")
        criticality = self.get_entity_criticality(entity)
        
        # Usage impact
        usage_impact = self.get_usage_impact(entity)
        
        # Dependency impact
        dependency_impact = self.get_dependency_impact(entity)
        
        # Weighted combination
        impact = (
            criticality * 0.5 + 
            usage_impact * 0.3 + 
            dependency_impact * 0.2
        )
        
        return min(1.0, impact)
    
    def calculate_urgency_weight(self, drift_alert: Dict) -> float:
        """Calculate temporal urgency weight (0-1)"""
        # Time since drift detected
        detection_time = drift_alert.get("detection_time", datetime.utcnow())
        hours_since_detection = (datetime.utcnow() - detection_time).total_seconds() / 3600
        
        # Urgency increases with time
        if hours_since_detection <= 24:
            time_urgency = 0.5
        elif hours_since_detection <= 168:  # 1 week
            time_urgency = 0.7
        else:
            time_urgency = 0.9
        
        # Incident correlation urgency
        incident_correlation = drift_alert.get("incident_correlation", 0)
        incident_urgency = min(1.0, incident_correlation * 0.3)
        
        # Combined urgency
        urgency = (time_urgency * 0.8 + incident_urgency * 0.2)
        
        return min(1.0, urgency)
    
    def get_entity_criticality(self, entity: str) -> float:
        """Get entity criticality score"""
        # Mock implementation - in real system, query entity importance
        critical_entities = ["payment_api", "user_auth", "database"]
        
        if entity in critical_entities:
            return 1.0
        elif "api" in entity.lower():
            return 0.8
        else:
            return 0.5
    
    def get_usage_impact(self, entity: str) -> float:
        """Get usage impact score"""
        # Mock implementation - in real system, query usage metrics
        return 0.7
    
    def get_dependency_impact(self, entity: str) -> float:
        """Get dependency impact score"""
        # Mock implementation - in real system, analyze dependencies
        return 0.6
