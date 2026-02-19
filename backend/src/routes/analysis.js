const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const logger = require('../utils/logger');
const axios = require('axios');

// Trigger document analysis
router.post('/document', [
  body('document_id').isUUID()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid document ID',
          details: errors.array()
        }
      });
    }

    const { document_id } = req.body;
    const aiEngineUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000';

    try {
      // Call AI engine for analysis
      const response = await axios.post(`${aiEngineUrl}/api/analyze/document`, {
        document_id,
        analysis_type: ['claims', 'embeddings', 'relationships']
      });

      res.json({
        success: true,
        data: response.data
      });

    } catch (aiError) {
      logger.error('AI Engine analysis failed:', aiError.message);
      res.status(503).json({
        success: false,
        error: {
          code: 'AI_ENGINE_UNAVAILABLE',
          message: 'AI analysis service unavailable'
        }
      });
    }

  } catch (error) {
    logger.error('Document analysis failed:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Document analysis failed'
      }
    });
  }
});

module.exports = router;
