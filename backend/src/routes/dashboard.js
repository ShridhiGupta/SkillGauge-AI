const express = require('express');
const { query, validationResult } = require('express-validator');
const router = express.Router();
const logger = require('../utils/logger');
const { query } = require('../database/connection');
const { getCache, setCache } = require('../cache/redis');

// Get dashboard overview
router.get('/overview', async (req, res) => {
  try {
    // Check cache first
    const cacheKey = 'dashboard:overview';
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult
      });
    }

    // Get system health metrics
    const healthQuery = `
      SELECT 
        COUNT(*) as total_documents,
        COUNT(CASE WHEN freshness_score >= 70 THEN 1 END) as fresh_documents,
        COUNT(CASE WHEN freshness_score < 50 THEN 1 END) as stale_documents,
        AVG(freshness_score) as avg_freshness_score
      FROM documents
    `;
    const healthResult = await query(healthQuery);
    const systemHealth = {
      overall_score: Math.round(healthResult.rows[0].avg_freshness_score || 0),
      document_count: parseInt(healthResult.rows[0].total_documents),
      fresh_documents: parseInt(healthResult.rows[0].fresh_documents),
      stale_documents: parseInt(healthResult.rows[0].stale_documents)
    };

    // Get alerts summary
    const alertsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN severity = 'risky' THEN 1 END) as risky,
        COUNT(CASE WHEN severity = 'informational' THEN 1 END) as informational,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_this_week
      FROM drift_alerts
      WHERE status != 'resolved'
    `;
    const alertsResult = await query(alertsQuery);
    const alertsSummary = {
      total: parseInt(alertsResult.rows[0].total),
      critical: parseInt(alertsResult.rows[0].critical),
      risky: parseInt(alertsResult.rows[0].risky),
      informational: parseInt(alertsResult.rows[0].informational),
      new_this_week: parseInt(alertsResult.rows[0].new_this_week)
    };

    // Get trends (last 30 days)
    const trendsQuery = `
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) as alerts_created
      FROM drift_alerts
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `;
    const trendsResult = await query(trendsQuery);
    
    // Generate trend arrays
    const alertTrend = [];
    const freshnessTrend = [];
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Alert trend
      const dayAlerts = trendsResult.rows.find(row => row.date.toISOString().split('T')[0] === dateStr);
      alertTrend.push(dayAlerts ? parseInt(dayAlerts.alerts_created) : 0);
      
      // Freshness trend (mock data for now)
      freshnessTrend.push(Math.floor(Math.random() * 20) + 60);
    }

    // Get top issues
    const topIssuesQuery = `
      SELECT 
        d.title as document,
        COUNT(da.id) as drift_count,
        MAX(da.severity) as severity
      FROM drift_alerts da
      JOIN documents d ON da.document_id = d.id
      WHERE da.status != 'resolved'
      GROUP BY d.id, d.title
      ORDER BY drift_count DESC
      LIMIT 5
    `;
    const topIssuesResult = await query(topIssuesQuery);
    const topIssues = topIssuesResult.rows.map(row => ({
      document: row.document,
      drift_count: parseInt(row.drift_count),
      severity: row.severity
    }));

    const result = {
      system_health: systemHealth,
      alerts_summary: alertsSummary,
      trends: {
        freshness_trend: freshnessTrend,
        alert_trend: alertTrend,
        drift_velocity: alertTrend.slice(-7).reduce((a, b) => a + b, 0) / 7
      },
      top_issues: topIssues
    };

    // Cache result for 5 minutes
    await setCache(cacheKey, result, 300);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to get dashboard overview:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve dashboard overview',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Get analytics data
router.get('/analytics', [
  query('team').optional().isString(),
  query('document_type').optional().isIn(['documentation', 'code', 'behavior']),
  query('date_from').optional().isISO8601(),
  query('date_to').optional().isISO8601(),
  query('granularity').optional().isIn(['daily', 'weekly', 'monthly'])
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
      document_type,
      date_from,
      date_to,
      granularity = 'daily'
    } = req.query;

    // Check cache first
    const cacheKey = `dashboard:analytics:${JSON.stringify(req.query)}`;
    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.json({
        success: true,
        data: cachedResult
      });
    }

    // Build date filter
    let dateFilter = '';
    const queryParams = [];
    let paramIndex = 1;

    if (date_from) {
      dateFilter += ` AND created_at >= $${paramIndex}`;
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      dateFilter += ` AND created_at <= $${paramIndex}`;
      queryParams.push(date_to);
      paramIndex++;
    }

    // Get time series data
    let timeGrouping;
    switch (granularity) {
      case 'weekly':
        timeGrouping = 'DATE_TRUNC(\'week\', created_at)';
        break;
      case 'monthly':
        timeGrouping = 'DATE_TRUNC(\'month\', created_at)';
        break;
      default:
        timeGrouping = 'DATE_TRUNC(\'day\', created_at)';
    }

    const timeSeriesQuery = `
      SELECT 
        ${timeGrouping} as timestamp,
        AVG(freshness_score) as avg_freshness,
        COUNT(*) as document_count,
        COUNT(CASE WHEN freshness_score < 50 THEN 1 END) as drift_count
      FROM documents
      WHERE 1=1 ${dateFilter}
      GROUP BY ${timeGrouping}
      ORDER BY timestamp
    `;
    const timeSeriesResult = await query(timeSeriesQuery, queryParams);
    const time_series = timeSeriesResult.rows.map(row => ({
      timestamp: row.timestamp.toISOString(),
      avg_freshness: parseFloat(row.avg_freshness) || 0,
      document_count: parseInt(row.document_count),
      drift_count: parseInt(row.drift_count)
    }));

    // Get distribution
    const distributionQuery = `
      SELECT 
        COUNT(CASE WHEN freshness_score >= 90 THEN 1 END) as excellent,
        COUNT(CASE WHEN freshness_score >= 70 AND freshness_score < 90 THEN 1 END) as good,
        COUNT(CASE WHEN freshness_score >= 50 AND freshness_score < 70 THEN 1 END) as fair,
        COUNT(CASE WHEN freshness_score < 50 THEN 1 END) as poor
      FROM documents
      WHERE 1=1 ${dateFilter}
    `;
    const distributionResult = await query(distributionQuery, queryParams);
    const distribution = {
      excellent: parseInt(distributionResult.rows[0].excellent),
      good: parseInt(distributionResult.rows[0].good),
      fair: parseInt(distributionResult.rows[0].fair),
      poor: parseInt(distributionResult.rows[0].poor)
    };

    // Get trends (mock data for now)
    const trends = {
      improving: ['API Documentation', 'Database Schema'],
      declining: ['Payment Processing', 'User Authentication'],
      stable: ['Frontend Components', 'Infrastructure Docs']
    };

    const result = {
      time_series,
      distribution,
      trends
    };

    // Cache result for 10 minutes
    await setCache(cacheKey, result, 600);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Failed to get analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve analytics',
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
