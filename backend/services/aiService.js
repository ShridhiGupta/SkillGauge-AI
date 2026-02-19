const axios = require('axios');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000';
    this.timeout = 30000; // 30 seconds timeout
  }

  async generateQuestion(params) {
    try {
      const response = await axios.post(`${this.aiEngineUrl}/ai/generate-question`, {
        context: {
          candidateSkills: params.candidateSkills || [],
          jobRole: params.jobRole,
          difficulty: params.difficulty,
          previousAnswers: params.previousAnswers || []
        },
        questionType: params.questionType || 'base',
        focusArea: params.focusArea
      }, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        return response.data.data.question;
      } else {
        throw new Error('Failed to generate question from AI engine');
      }

    } catch (error) {
      logger.error('Error generating question:', error.message);
      
      // Fallback question generation
      return this.generateFallbackQuestion(params);
    }
  }

  async analyzeResponse(params) {
    try {
      const response = await axios.post(`${this.aiEngineUrl}/ai/analyze-response`, {
        question: {
          id: params.question.id,
          text: params.question.text,
          type: params.question.type,
          keyConcepts: params.question.keyConcepts || []
        },
        response: {
          text: params.response,
          responseType: params.responseType,
          timeSpent: params.timeSpent,
          confidence: params.confidence
        },
        candidateContext: params.candidateContext
      }, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error('Failed to analyze response from AI engine');
      }

    } catch (error) {
      logger.error('Error analyzing response:', error.message);
      
      // Fallback analysis
      return this.generateFallbackAnalysis(params);
    }
  }

  async generateFollowUpQuestions(params) {
    try {
      const response = await axios.post(`${this.aiEngineUrl}/ai/generate-followup`, {
        currentResponse: params.currentResponse,
        analysis: params.analysis,
        interviewContext: params.interviewContext
      }, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        return response.data.data.questions;
      } else {
        throw new Error('Failed to generate follow-up questions from AI engine');
      }

    } catch (error) {
      logger.error('Error generating follow-up questions:', error.message);
      
      // Fallback follow-up questions
      return this.generateFallbackFollowUps(params);
    }
  }

  async getFinalEvaluation(params) {
    try {
      const response = await axios.post(`${this.aiEngineUrl}/ai/final-evaluation`, {
        interviewId: params.interviewId,
        allResponses: params.allResponses,
        candidateProfile: params.candidateProfile
      }, {
        timeout: this.timeout * 2, // Longer timeout for final evaluation
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error('Failed to get final evaluation from AI engine');
      }

    } catch (error) {
      logger.error('Error getting final evaluation:', error.message);
      
      // Fallback evaluation
      return this.generateFallbackEvaluation(params);
    }
  }

  // Fallback methods when AI engine is unavailable
  generateFallbackQuestion(params) {
    const fallbackQuestions = {
      junior: {
        'software-engineer': 'Can you explain the difference between let, const, and var in JavaScript?',
        'data-scientist': 'What is the difference between supervised and unsupervised learning?',
        'product-manager': 'How would you prioritize features for a new product launch?'
      },
      mid: {
        'software-engineer': 'Explain how you would optimize a React application for performance.',
        'data-scientist': 'How would you handle imbalanced datasets in a classification problem?',
        'product-manager': 'Describe your approach to user research and how you incorporate feedback.'
      },
      senior: {
        'software-engineer': 'Design a scalable microservices architecture for an e-commerce platform.',
        'data-scientist': 'How would you design and implement a real-time recommendation system?',
        'product-manager': 'How would you develop a product strategy for entering a new market segment?'
      }
    };

    const level = params.difficulty || 'mid';
    const role = params.jobRole?.toLowerCase() || 'software-engineer';
    
    return {
      id: `fallback-${Date.now()}`,
      text: fallbackQuestions[level]?.[role] || fallbackQuestions.mid['software-engineer'],
      type: 'technical',
      difficulty: level === 'junior' ? 3 : level === 'mid' ? 6 : 8,
      keyConcepts: [],
      timeLimit: 300
    };
  }

  generateFallbackAnalysis(params) {
    // Simple heuristic-based analysis as fallback
    const responseLength = params.response.length;
    const wordCount = params.response.split(' ').length;
    
    // Basic scoring based on response characteristics
    let technicalDepth = Math.min(10, Math.max(1, wordCount / 20));
    let originality = Math.random() * 3 + 5; // Random between 5-8
    let consistency = Math.random() * 2 + 6; // Random between 6-8
    let practicalKnowledge = Math.min(10, Math.max(1, responseLength / 100));

    return {
      scores: {
        technicalDepth,
        originality,
        consistency,
        practicalKnowledge
      },
      skillInflation: {
        detected: false,
        buzzwords: [],
        vagueStatements: [],
        mismatchedClaims: []
      },
      followUpSuggestions: [
        {
          type: 'clarification',
          question: 'Can you provide more specific details about your approach?',
          priority: 'medium'
        }
      ],
      redFlags: []
    };
  }

  generateFallbackFollowUps(params) {
    return [
      {
        id: `followup-${Date.now()}-1`,
        text: 'Can you elaborate on the key points you mentioned?',
        type: 'clarification',
        priority: 'medium'
      },
      {
        id: `followup-${Date.now()}-2`,
        text: 'How would you apply this in a real-world scenario?',
        type: 'depth',
        priority: 'high'
      }
    ];
  }

  generateFallbackEvaluation(params) {
    // Calculate average scores from all responses
    const allScores = params.allResponses.map(r => r.scores);
    const avgScores = {
      technicalDepth: allScores.reduce((sum, s) => sum + s.technicalDepth, 0) / allScores.length,
      consistency: allScores.reduce((sum, s) => sum + s.consistency, 0) / allScores.length,
      originality: allScores.reduce((sum, s) => sum + s.originality, 0) / allScores.length,
      practicalKnowledge: allScores.reduce((sum, s) => sum + s.practicalKnowledge, 0) / allScores.length
    };

    // Calculate final SAI
    const skillAuthenticityIndex = (
      avgScores.technicalDepth * 0.35 +
      avgScores.consistency * 0.25 +
      avgScores.originality * 0.20 +
      avgScores.practicalKnowledge * 0.20
    );

    // Determine recommendation
    let recommendation;
    if (skillAuthenticityIndex >= 85) {
      recommendation = { decision: 'hire', confidence: 0.9 };
    } else if (skillAuthenticityIndex >= 70) {
      recommendation = { decision: 'hold', confidence: 0.7 };
    } else {
      recommendation = { decision: 'reject', confidence: 0.8 };
    }

    return {
      finalScores: avgScores,
      recommendation: {
        ...recommendation,
        reasoning: `Based on the overall performance with a Skill Authenticity Index of ${skillAuthenticityIndex.toFixed(1)}`,
        keyStrengths: [],
        keyConcerns: []
      },
      detailedReport: {
        skillVerification: {
          verified: params.candidateProfile.claimedSkills.slice(0, 2),
          inflated: [],
          unverified: params.candidateProfile.claimedSkills.slice(2)
        },
        redFlags: [],
        interviewSummary: 'Interview completed with automated analysis.'
      }
    };
  }

  // Health check for AI service
  async healthCheck() {
    try {
      const response = await axios.get(`${this.aiEngineUrl}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      logger.error('AI engine health check failed:', error.message);
      return false;
    }
  }
}

module.exports = new AIService();
