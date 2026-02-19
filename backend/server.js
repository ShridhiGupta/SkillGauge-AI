const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const winston = require('winston');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const interviewRoutes = require('./routes/interviews');
const candidateRoutes = require('./routes/candidates');
const dashboardRoutes = require('./routes/dashboard');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { authenticateSocket } = require('./middleware/socketAuth');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/skillgauge', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => logger.info('Connected to MongoDB'))
.catch(err => logger.error('MongoDB connection error:', err));

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Data sanitization
app.use(mongoSanitize()); // NoSQL injection protection
app.use(xss()); // XSS protection
app.use(hpp()); // HTTP parameter pollution protection

// Compression
app.use(compression());

// Socket.IO authentication middleware
io.use(authenticateSocket);

// Socket.IO connection handling
const activeInterviews = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.user.id}`);
  
  // Store user socket mapping
  userSockets.set(socket.user.id, socket.id);

  // Join interview room
  socket.on('join-interview', async (data) => {
    try {
      const { interviewId } = data;
      
      // Verify user has access to this interview
      const Interview = require('./models/Interview');
      const interview = await Interview.findById(interviewId);
      
      if (!interview) {
        socket.emit('error', { message: 'Interview not found' });
        return;
      }

      socket.join(`interview-${interviewId}`);
      
      // Store interview session
      if (!activeInterviews.has(interviewId)) {
        activeInterviews.set(interviewId, {
          participants: new Set(),
          startTime: new Date(),
          currentQuestion: interview.currentQuestion,
          scores: interview.scores || {}
        });
      }
      
      activeInterviews.get(interviewId).participants.add(socket.user.id);
      
      socket.emit('joined-interview', { interviewId });
      logger.info(`User ${socket.user.id} joined interview ${interviewId}`);
      
    } catch (error) {
      logger.error('Error joining interview:', error);
      socket.emit('error', { message: 'Failed to join interview' });
    }
  });

  // Handle response submission
  socket.on('submit-response', async (data) => {
    try {
      const { interviewId, questionId, response, responseType, timeSpent } = data;
      
      // Get interview session
      const session = activeInterviews.get(interviewId);
      if (!session) {
        socket.emit('error', { message: 'Interview session not found' });
        return;
      }

      // Call AI service for analysis
      const aiService = require('./services/aiService');
      const analysis = await aiService.analyzeResponse({
        questionId,
        response,
        responseType,
        interviewId,
        userId: socket.user.id
      });

      // Update session scores
      session.scores = {
        ...session.scores,
        technicalDepth: (session.scores.technicalDepth || 0 + analysis.scores.technicalDepth) / 2,
        consistency: (session.scores.consistency || 0 + analysis.scores.consistency) / 2,
        originality: (session.scores.originality || 0 + analysis.scores.originality) / 2,
        practicalKnowledge: (session.scores.practicalKnowledge || 0 + analysis.scores.practicalKnowledge) / 2
      };

      // Send analysis back to user
      socket.emit('response-analysis', {
        questionId,
        scores: analysis.scores,
        feedback: analysis.feedback,
        redFlags: analysis.redFlags
      });

      // Broadcast to other participants (if any)
      socket.to(`interview-${interviewId}`).emit('participant-response', {
        userId: socket.user.id,
        questionId,
        analysis: analysis.scores
      });

      logger.info(`Response analyzed for interview ${interviewId}, question ${questionId}`);
      
    } catch (error) {
      logger.error('Error analyzing response:', error);
      socket.emit('error', { message: 'Failed to analyze response' });
    }
  });

  // Request next question
  socket.on('request-next-question', async (data) => {
    try {
      const { interviewId, analysis } = data;
      
      // Generate next question using AI service
      const aiService = require('./services/aiService');
      const nextQuestion = await aiService.generateNextQuestion({
        interviewId,
        previousAnalysis: analysis,
        userId: socket.user.id
      });

      // Update session
      const session = activeInterviews.get(interviewId);
      if (session) {
        session.currentQuestion = nextQuestion;
      }

      // Send question to user
      socket.emit('question-generated', {
        question: nextQuestion,
        context: {
          questionNumber: session?.questionNumber || 1,
          totalQuestions: 10
        }
      });

      logger.info(`Next question generated for interview ${interviewId}`);
      
    } catch (error) {
      logger.error('Error generating next question:', error);
      socket.emit('error', { message: 'Failed to generate next question' });
    }
  });

  // Handle interview status updates
  socket.on('interview-status', (data) => {
    const { interviewId, status } = data;
    const session = activeInterviews.get(interviewId);
    
    if (session) {
      session.status = status;
      
      // Broadcast status update
      io.to(`interview-${interviewId}`).emit('interview-status', {
        status,
        currentScores: session.scores,
        timeRemaining: session.timeRemaining
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.user.id}`);
    
    // Remove from all interview sessions
    activeInterviews.forEach((session, interviewId) => {
      session.participants.delete(socket.user.id);
      
      // Notify other participants
      socket.to(`interview-${interviewId}`).emit('participant-disconnected', {
        userId: socket.user.id
      });
      
      // Clean up empty sessions
      if (session.participants.size === 0) {
        activeInterviews.delete(interviewId);
      }
    });
    
    userSockets.delete(socket.user.id);
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    activeInterviews: activeInterviews.size,
    connectedUsers: userSockets.size
  });
});

// 404 handler
app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.status = 'fail';
  err.statusCode = 404;
  next(err);
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    mongoose.connection.close();
  });
});

module.exports = { app, server, io };
