const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const router = express.Router();
const logger = require('../utils/logger');
const { query } = require('../database/connection');
const { getCache, setCache, deleteCache } = require('../cache/redis');

// Get all alerts with filtering and pagination
router.get('/', [
  query('severity').optional().isIn(['informational', 'risky', 'critical']),
  query('status').optional().isIn(['open', 'acknowledged', 'resolved']),
  query('document_id').optional().isUUID(),
  query('team').optional().isString(),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
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
      severity,
      status,
      document_id,
      team,
      date_from,
      date_to,
      page = 1,
      limit = 20
    } = req.query;

    // Check cache first
    const cacheKey = `alerts:${JSON.stringify(req.query)}`;
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

    if (severity) {
      whereClause += ` AND da.severity = $${paramIndex}`;
      queryParams.push(severity);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND da.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    if (document_id) {
      whereClause += ` AND da.document_id = $${paramIndex}`;
      queryParams.push(document_id);
      paramIndex++;
    }

    if (team) {
      whereClause += ` AND d.metadata->>'team' = $${paramIndex}`;
      queryParams.push(team);
      paramIndex++;
    }

    if (date_from) {
      whereClause += ` AND da.created_at >= $${paramIndex}`;
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereClause += ` AND da.created_at <= $${paramIndex}`;
      queryParams.push(date_to);
      paramIndex++;
    }

    const offset = (page - 1) * limit;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM drift_alerts da
      JOIN documents d ON da.document_id = d.id
      ${whereClause}
    `;
    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);

    // Get alerts
    const alertsQuery = `
      SELECT 
        da.id,
        da.title,
        da.severity,
        da.status,
        da.confidence,
        da.drift_severity_score,
        da.created_at,
        da.updated_at,
        da.contradiction,
        da.evidence,
        da.risk_assessment,
        da.recommended_actions,
        d.id as document_id,
        d.title as document_title,
        d.source_path as document_source_path,
        d.type as document_type
      FROM drift_alerts da
      JOIN documents d ON da.document_id = d.id
      ${whereClause}
      ORDER BY da.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const alertsResult = await query(alertsQuery, queryParams);
    const alerts = alertsResult.rows;

    const totalPages = Math.ceil(total / limit);

    // Get summary counts
    const summaryQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN severity = 'risky' THEN 1 END) as risky,
        COUNT(CASE WHEN severity = 'informational' THEN 1 END) as informational,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_this_week
      FROM drift_alerts da
      JOIN documents d ON da.document_id = d.id
      ${whereClause}
    `;
    const summaryResult = await query(summaryQuery, queryParams.slice(0, -2)); // Remove limit and offset
    const summary = summaryResult.rows[0];

    const result = {
      alerts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages
      },
      summary: {
        total: parseInt(summary.total),
        critical: parseInt(summary.critical),
        risky: parseInt(summary.risky),
        informational: parseInt(summary.informational),
        new_this_week: parseInt(summary.new_this_week)
      }
    };

    // Cache result for 2 minutes
    await setCache(cacheKey, result, 120);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to get alerts:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve alerts',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Acknowledge alert
router.post('/:id/acknowledge', [
  param('id').isUUID(),
  body('acknowledged_by').optional().isString(),
  body('notes').optional().isString()
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

    const { id } = req.params;
    const { acknowledged_by, notes } = req.body;

    // Update alert
    const updateQuery = `
      UPDATE drift_alerts 
      SET status = 'acknowledged',
          acknowledged_by = $1,
          acknowledged_at = NOW(),
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await query(updateQuery, [acknowledged_by || 'system', id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Alert not found'
        }
      });
    }

    const alert = result.rows[0];

    // Clear caches
    await deleteCache('alerts:*');
    await deleteCache(`alert:${id}`);

    // Emit WebSocket event
    const io = req.app.get('io');
    io.to('alerts').emit('alert:updated', alert);

    logger.info(`Alert acknowledged: ${id}`, { acknowledged_by, notes });

    res.json({
      success: true,
      data: { alert }
    });

  } catch (error) {
    logger.error('Failed to acknowledge alert:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to acknowledge alert',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Resolve alert
router.post('/:id/resolve', [
  param('id').isUUID(),
  body('resolved_by').optional().isString(),
  body('resolution_type').isIn(['documentation_updated', 'code_fixed', 'false_positive', 'other']),
  body('notes').optional().isString()
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

    const { id } = req.params;
    const { resolved_by, resolution_type, notes } = req.body;

    // Update alert
    const updateQuery = `
      UPDATE drift_alerts 
      SET status = 'resolved',
          resolved_by = $1,
          resolved_at = NOW(),
          resolution_type = $2,
          resolution_notes = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const result = await query(updateQuery, [resolved_by || 'system', resolution_type, notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Alert not found'
        }
      });
    }

    const alert = result.rows[0];

    // Clear caches
    await deleteCache('alerts:*');
    await deleteCache(`alert:${id}`);

    // Emit WebSocket event
    const io = req.app.get('io');
    io.to('alerts').emit('alert:resolved', alert);

    logger.info(`Alert resolved: ${id}`, { resolved_by, resolution_type, notes });

    res.json({
      success: true,
      data: { alert }
    });

  } catch (error) {
    logger.error('Failed to resolve alert:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to resolve alert',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Get single alert by ID
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
          message: 'Invalid alert ID',
          details: errors.array()
        }
      });
    }

    const { id } = req.params;

    // Check cache first
    const cacheKey = `alert:${id}`;
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult
      });
    }

    // Get alert
    const alertQuery = `
      SELECT 
        da.*,
        d.title as document_title,
        d.source_path as document_source_path,
        d.type as document_type
      FROM drift_alerts da
      JOIN documents d ON da.document_id = d.id
      WHERE da.id = $1
    `;
    const result = await query(alertQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Alert not found'
        }
      });
    }

    const alert = result.rows[0];

    // Cache result for 5 minutes
    await setCache(cacheKey, alert, 300);

    res.json({
      success: true,
      data: alert
    });

  } catch (error) {
    logger.error('Failed to get alert:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve alert',
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
