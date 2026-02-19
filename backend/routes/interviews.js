const express = require('express');
const router = express.Router();
const Interview = require('../models/Interview');
const Candidate = require('../models/Candidate');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const aiService = require('../services/aiService');

// Protect all routes
router.use(protect);

// Create new interview
router.post('/create', [
  body('candidateId').notEmpty().withMessage('Candidate ID is required'),
  body('jobRole').notEmpty().withMessage('Job role is required'),
  body('skillRequirements').isArray().withMessage('Skill requirements must be an array'),
  body('difficulty').isIn(['junior', 'mid', 'senior']).withMessage('Invalid difficulty level')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { candidateId, jobRole, skillRequirements, difficulty } = req.body;

    // Verify candidate exists
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CANDIDATE_NOT_FOUND',
          message: 'Candidate not found'
        }
      });
    }

    // Generate first question using AI service
    const firstQuestion = await aiService.generateQuestion({
      candidateSkills: candidate.skills,
      jobRole,
      difficulty,
      questionType: 'base'
    });

    // Create interview session
    const interview = new Interview({
      candidate: candidateId,
      jobRole,
      skillRequirements,
      difficulty,
      recruiter: req.user.id,
      status: 'active',
      questions: [firstQuestion],
      currentQuestionIndex: 0,
      scores: {
        technicalDepth: 0,
        consistency: 0,
        originality: 0,
        practicalKnowledge: 0
      },
      startTime: new Date()
    });

    await interview.save();

    res.status(201).json({
      success: true,
      data: {
        interviewId: interview._id,
        sessionId: interview._id,
        firstQuestion: firstQuestion
      }
    });

  } catch (error) {
    console.error('Error creating interview:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create interview'
      }
    });
  }
});

// Submit response
router.post('/:interviewId/submit-response', [
  body('questionId').notEmpty().withMessage('Question ID is required'),
  body('response').notEmpty().withMessage('Response is required'),
  body('responseType').isIn(['text', 'code']).withMessage('Invalid response type'),
  body('timeSpent').isNumeric().withMessage('Time spent must be a number'),
  body('confidence').isFloat({ min: 1, max: 10 }).withMessage('Confidence must be between 1 and 10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { interviewId } = req.params;
    const { questionId, response, responseType, timeSpent, confidence } = req.body;

    // Find interview
    const interview = await Interview.findById(interviewId).populate('candidate');
    if (!interview) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'INTERVIEW_NOT_FOUND',
          message: 'Interview not found'
        }
      });
    }

    // Verify interview is active
    if (interview.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INTERVIEW_NOT_ACTIVE',
          message: 'Interview is not active'
        }
      });
    }

    // Analyze response using AI service
    const analysis = await aiService.analyzeResponse({
      question: interview.questions[interview.currentQuestionIndex],
      response,
      responseType,
      timeSpent,
      confidence,
      candidateContext: {
        claimedSkills: interview.candidate.skills,
        experienceLevel: interview.candidate.experienceLevel,
        previousResponses: interview.responses.map(r => r.text)
      }
    });

    // Add response to interview
    interview.responses.push({
      questionId,
      text: response,
      responseType,
      timeSpent,
      confidence,
      scores: analysis.scores,
      analysis: {
        skillInflation: analysis.skillInflation.detected,
        aiGenerated: analysis.originality.aiProbability > 0.8,
        redFlags: analysis.redFlags.map(f => f.description)
      }
    });

    // Update scores (running average)
    const responseCount = interview.responses.length;
    interview.scores = {
      technicalDepth: ((interview.scores.technicalDepth * (responseCount - 1)) + analysis.scores.technicalDepth) / responseCount,
      consistency: ((interview.scores.consistency * (responseCount - 1)) + analysis.scores.consistency) / responseCount,
      originality: ((interview.scores.originality * (responseCount - 1)) + analysis.scores.originality) / responseCount,
      practicalKnowledge: ((interview.scores.practicalKnowledge * (responseCount - 1)) + analysis.scores.practicalKnowledge) / responseCount
    };

    // Generate follow-up questions
    const followUpQuestions = await aiService.generateFollowUpQuestions({
      currentResponse: response,
      analysis,
      interviewContext: {
        jobRole: interview.jobRole,
        difficulty: interview.difficulty,
        previousQuestions: interview.questions.slice(0, interview.currentQuestionIndex + 1)
      }
    });

    await interview.save();

    res.json({
      success: true,
      data: {
        followUpQuestions: followUpQuestions,
        realTimeScores: analysis.scores,
        redFlags: analysis.redFlags
      }
    });

  } catch (error) {
    console.error('Error submitting response:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to submit response'
      }
    });
  }
});

// Get interview status
router.get('/:interviewId/status', async (req, res) => {
  try {
    const { interviewId } = req.params;

    const interview = await Interview.findById(interviewId)
      .populate('candidate', 'name email skills experienceLevel')
      .populate('recruiter', 'name email');

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'INTERVIEW_NOT_FOUND',
          message: 'Interview not found'
        }
      });
    }

    // Calculate time remaining
    const timeElapsed = Date.now() - new Date(interview.startTime).getTime();
    const totalTime = 60 * 60 * 1000; // 1 hour
    const timeRemaining = Math.max(0, totalTime - timeElapsed);

    // Get current question
    const currentQuestion = interview.questions[interview.currentQuestionIndex];

    // Extract red flags from responses
    const redFlags = interview.responses
      .filter(r => r.analysis.redFlags.length > 0)
      .flatMap(r => r.analysis.redFlags);

    res.json({
      success: true,
      data: {
        interviewId: interview._id,
        status: interview.status,
        currentQuestion,
        scores: interview.scores,
        redFlags: [...new Set(redFlags)], // Remove duplicates
        candidate: interview.candidate,
        recruiter: interview.recruiter,
        timeRemaining: Math.floor(timeRemaining / 1000),
        currentQuestionIndex: interview.currentQuestionIndex,
        totalQuestions: interview.questions.length
      }
    });

  } catch (error) {
    console.error('Error getting interview status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get interview status'
      }
    });
  }
});

// Complete interview and get final evaluation
router.post('/:interviewId/complete', async (req, res) => {
  try {
    const { interviewId } = req.params;

    const interview = await Interview.findById(interviewId).populate('candidate');

    if (!interview) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'INTERVIEW_NOT_FOUND',
          message: 'Interview not found'
        }
      });
    }

    // Get final evaluation from AI service
    const finalEvaluation = await aiService.getFinalEvaluation({
      interviewId,
      allResponses: interview.responses,
      candidateProfile: {
        claimedSkills: interview.candidate.skills,
        experienceYears: interview.candidate.experienceYears,
        resumeAnalysis: interview.candidate.resumeAnalysis
      }
    });

    // Update interview with final results
    interview.status = 'completed';
    interview.endTime = new Date();
    interview.finalScores = finalEvaluation.finalScores;
    interview.recommendation = finalEvaluation.recommendation;
    interview.detailedReport = finalEvaluation.detailedReport;

    await interview.save();

    res.json({
      success: true,
      data: finalEvaluation
    });

  } catch (error) {
    console.error('Error completing interview:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to complete interview'
      }
    });
  }
});

// Get interview history for recruiter
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const interviews = await Interview.find({ recruiter: req.user.id })
      .populate('candidate', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Interview.countDocuments({ recruiter: req.user.id });

    res.json({
      success: true,
      data: {
        interviews,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting interview history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get interview history'
      }
    });
  }
});

module.exports = router;
