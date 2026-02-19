const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const router = express.Router();
const logger = require('../utils/logger');
const { query } = require('../database/connection');
const { getCache, setCache, deleteCache } = require('../cache/redis');

// Get all documents with filtering and pagination
router.get('/', [
  query('team').optional().isString(),
  query('type').optional().isIn(['documentation', 'code', 'behavior']),
  query('freshness_min').optional().isFloat({ min: 0, max: 100 }),
  query('freshness_max').optional().isFloat({ min: 0, max: 100 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid query parameters',
          details: errors.array()
        }
      });
    }

    const {
      team,
      type,
      freshness_min,
      freshness_max,
      page = 1,
      limit = 20
    } = req.query;

    // Check cache first
    const cacheKey = `documents:${JSON.stringify(req.query)}`;
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult
      });
    }

    // Build query
    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramIndex = 1;

    if (team) {
      whereClause += ` AND metadata->>'team' = $${paramIndex}`;
      queryParams.push(team);
      paramIndex++;
    }

    if (type) {
      whereClause += ` AND type = $${paramIndex}`;
      queryParams.push(type);
      paramIndex++;
    }

    if (freshness_min) {
      whereClause += ` AND freshness_score >= $${paramIndex}`;
      queryParams.push(freshness_min);
      paramIndex++;
    }

    if (freshness_max) {
      whereClause += ` AND freshness_score <= $${paramIndex}`;
      queryParams.push(freshness_max);
      paramIndex++;
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM documents ${whereClause}`;
    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get documents
    const documentsQuery = `
      SELECT 
        id,
        title,
        type,
        source_path,
        last_modified,
        created_at,
        updated_at,
        freshness_score,
        business_importance,
        usage_frequency,
        metadata
      FROM documents 
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const documentsResult = await query(documentsQuery, queryParams);
    const documents = documentsResult.rows;

    const totalPages = Math.ceil(total / limit);

    const result = {
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages
      }
    };

    // Cache result for 5 minutes
    await setCache(cacheKey, result, 300);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to get documents:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve documents',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Get single document by ID
router.get('/:id', [
  param('id').isUUID()
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

    const { id } = req.params;

    // Check cache first
    const cacheKey = `document:${id}`;
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult
      });
    }

    // Get document
    const documentQuery = `
      SELECT 
        id,
        title,
        type,
        source_path,
        content,
        last_modified,
        created_at,
        updated_at,
        metadata,
        freshness_score,
        business_importance,
        usage_frequency
      FROM documents 
      WHERE id = $1
    `;
    const documentResult = await query(documentQuery, [id]);

    if (documentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Document not found'
        }
      });
    }

    const document = documentResult.rows[0];

    // Get drift alerts for this document
    const alertsQuery = `
      SELECT 
        id,
        title,
        severity,
        status,
        confidence,
        drift_severity_score,
        created_at,
        updated_at
      FROM drift_alerts 
      WHERE document_id = $1
      ORDER BY created_at DESC
    `;
    const alertsResult = await query(alertsQuery, [id]);
    const drift_alerts = alertsResult.rows;

    // Get historical scores
    const scoresQuery = `
      SELECT 
        score_type,
        score_value,
        calculated_at
      FROM historical_scores 
      WHERE document_id = $1
      ORDER BY calculated_at DESC
      LIMIT 30
    `;
    const scoresResult = await query(scoresQuery, [id]);
    const historical_scores = scoresResult.rows;

    const result = {
      document,
      drift_alerts,
      historical_scores
    };

    // Cache result for 10 minutes
    await setCache(cacheKey, result, 600);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to get document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve document',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Ingest new document
router.post('/ingest', [
  body('source_type').isIn(['markdown', 'pdf', 'wiki', 'code', 'logs']),
  body('source_path').isString().isLength({ min: 1, max: 500 }),
  body('content').optional().isString(),
  body('metadata').optional().isObject(),
  body('priority').optional().isIn(['low', 'medium', 'high'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid request body',
          details: errors.array()
        }
      });
    }

    const {
      source_type,
      source_path,
      content,
      metadata = {},
      priority = 'medium'
    } = req.body;

    // Generate ingestion ID
    const ingestionId = require('uuid').v4();

    // Create ingestion job (in a real implementation, this would go to a queue)
    const ingestionJob = {
      ingestion_id: ingestionId,
      source_type,
      source_path,
      content,
      metadata: {
        ...metadata,
        priority,
        ingested_by: req.user?.id || 'system',
        ingested_at: new Date().toISOString()
      },
      status: 'queued',
      created_at: new Date().toISOString()
    };

    // Clear relevant caches
    await deleteCache('documents:*');

    // In a real implementation, you would:
    // 1. Add job to queue (Bull, Redis, etc.)
    // 2. Process content with AI engine
    // 3. Store results in database
    // 4. Update document freshness scores

    logger.info(`Document ingestion queued: ${ingestionId}`, ingestionJob);

    res.status(202).json({
      success: true,
      data: {
        ingestion_id: ingestionId,
        status: 'queued',
        estimated_completion: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      }
    });

  } catch (error) {
    logger.error('Failed to ingest document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to ingest document',
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
