# SkillGauge AI - Run Instructions

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** 18+ 
- **Python** 3.9+
- **Docker** & Docker Compose
- **Git**

### 1. Project Setup

```bash
# Clone the repository
git clone <repository-url>
cd knowledge-drift-detector

# Install dependencies
npm run setup
```

### 2. Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

**Required Environment Variables:**
```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=knowledge_drift
POSTGRES_USER=drift_user
POSTGRES_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# LLM
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3

# Backend
BACKEND_PORT=3000
JWT_SECRET=your_jwt_secret
```

### 3. Development Setup

#### Option A: Docker Development (Recommended)
```bash
# Start all services with Docker
npm run docker:dev
```

This starts:
- PostgreSQL database
- Redis cache
- ChromaDB vector database
- Ollama LLM service
- Backend API (port 3000)
- AI Engine (port 8000)

#### Option B: Local Development
```bash
# Start backend
cd backend
npm install
npm run dev

# Start AI engine (new terminal)
cd ai-engine
pip install -r requirements.txt
python main.py

# Start vector database (new terminal)
docker run -p 8000:8000 chromadb/chroma
```

### 4. Verify Setup

#### Check Backend Health
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "uptime": 123.45,
  "environment": "development"
}
```

#### Check AI Engine Health
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0"
}
```

### 5. Frontend Setup (When Ready)
```bash
cd frontend
npm install
npm start
```

Frontend will be available at: http://localhost:3001

## 🔧 Development Workflow

### 1. Making Changes
```bash
# Backend changes
cd backend
npm run dev  # Auto-restarts on changes

# AI Engine changes  
cd ai-engine
uvicorn main:app --reload  # Auto-restarts on changes
```

### 2. Testing
```bash
# Backend tests
cd backend
npm test

# AI Engine tests
cd ai-engine
pytest
```

### 3. Database Operations
```bash
# Run migrations
cd backend
npm run migrate

# Seed sample data
npm run seed
```

## 🐛 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port
netstat -tulpn | grep :3000

# Kill process
kill -9 <PID>
```

#### Database Connection Issues
```bash
# Check PostgreSQL status
docker ps | grep postgres

# Check logs
docker logs knowledge-drift-postgres-1
```

#### LLM Service Issues
```bash
# Check Ollama status
docker ps | grep ollama

# Check available models
docker exec -it <ollama-container> ollama list

# Pull required models
docker exec -it <ollama-container> ollama pull llama3
```

#### Vector Database Issues
```bash
# Check ChromaDB status
curl http://localhost:8000/api/v1/heartbeat

# Reset ChromaDB data
docker volume rm knowledge-drift_chroma_data
```

### Dependency Issues

#### Node.js Module Not Found
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules
rm -rf node_modules

# Reinstall
npm install
```

#### Python Package Issues
```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Reinstall requirements
pip install -r requirements.txt
```

## 📊 Monitoring

### Check Logs
```bash
# Backend logs
docker logs knowledge-drift-backend-1 -f

# AI Engine logs
docker logs knowledge-drift-ai-engine-1 -f

# Database logs
docker logs knowledge-drift-postgres-1 -f
```

### Performance Monitoring
```bash
# Check resource usage
docker stats

# Check container health
docker-compose ps
```

## 🚀 Production Deployment

### Build for Production
```bash
# Build all services
npm run build

# Or use production Docker Compose
docker-compose -f docker-compose.prod.yml up --build
```

### Environment Setup
```bash
# Production environment variables
NODE_ENV=production
LOG_LEVEL=warn
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## 📝 Development Notes

### Code Quality
```bash
# Lint backend code
cd backend
npm run lint

# Fix linting issues
npm run lint:fix
```

### Git Workflow
```bash
# Add changes
git add .

# Commit with message
git commit -m "Descriptive commit message"

# Push to repository
git push origin main
```

### Branch Strategy
- `main`: Production-ready code
- `develop`: Integration branch
- `feature/*`: Feature development
- `hotfix/*`: Production fixes

## 🔗 Useful Commands

### Docker Management
```bash
# Stop all services
docker-compose -f docker-compose.dev.yml down

# Remove containers and volumes
docker-compose -f docker-compose.dev.yml down -v

# Rebuild and restart
docker-compose -f docker-compose.dev.yml up --build --force-recreate
```

### Database Management
```bash
# Connect to PostgreSQL
docker exec -it knowledge-drift-postgres-1 psql -U drift_user -d knowledge_drift

# Connect to Redis
docker exec -it knowledge-drift-redis-1 redis-cli

# Reset database
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up postgres
```

### API Testing
```bash
# Test backend endpoints
curl -X GET http://localhost:3000/api/documents
curl -X POST http://localhost:3000/api/documents/ingest -H "Content-Type: application/json" -d '{"source_type":"markdown","source_path":"test.md"}'

# Test AI engine
curl -X POST http://localhost:8000/api/analyze/document -H "Content-Type: application/json" -d '{"document_id":"test","content":"test content"}'
```

## 📚 API Documentation

### Backend Endpoints
- `GET /health` - Health check
- `GET /api/documents` - List documents
- `POST /api/documents/ingest` - Ingest document
- `GET /api/alerts` - List drift alerts
- `POST /api/alerts/:id/acknowledge` - Acknowledge alert
- `GET /api/dashboard/overview` - Dashboard metrics

### AI Engine Endpoints
- `GET /health` - Health check
- `POST /api/analyze/document` - Analyze document
- `POST /api/detect/drift` - Detect drift
- `POST /api/score/document` - Score document

## 🎯 Next Steps

1. **Complete Frontend Implementation**
2. **Add Comprehensive Testing**
3. **Set Up CI/CD Pipeline**
4. **Configure Monitoring**
5. **Deploy to Production**

## 📞 Support

For issues:
1. Check logs using commands above
2. Verify environment variables
3. Ensure all services are running
4. Check network connectivity between services

For feature requests or bug reports, create an issue in the project repository.
