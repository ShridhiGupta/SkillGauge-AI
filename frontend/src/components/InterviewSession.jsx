import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Send, 
  Clock, 
  User, 
  TrendingUp, 
  AlertTriangle,
  Mic,
  MicOff,
  Video,
  VideoOff
} from 'lucide-react';
import ScoreRing from './ui/ScoreRing';
import QuestionCard from './ui/QuestionCard';
import ResponseAnalysis from './ui/ResponseAnalysis';
import ProgressBar from './ui/ProgressBar';

const InterviewSession = ({ socket }) => {
  const { interviewId } = useParams();
  const navigate = useNavigate();
  const [interview, setInterview] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [response, setResponse] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const responseRef = useRef(null);

  useEffect(() => {
    fetchInterviewData();
    startTimer();
    
    if (socket) {
      socket.on('question-generated', handleNewQuestion);
      socket.on('response-analysis', handleAnalysis);
      socket.on('interview-status', handleStatusUpdate);
      
      return () => {
        socket.off('question-generated', handleNewQuestion);
        socket.off('response-analysis', handleAnalysis);
        socket.off('interview-status', handleStatusUpdate);
      };
    }
  }, [socket, interviewId]);

  const fetchInterviewData = async () => {
    try {
      const response = await fetch(`/api/interviews/${interviewId}/status`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      
      if (data.success) {
        setInterview(data.data);
        setCurrentQuestion(data.data.currentQuestion);
        setTimeRemaining(data.data.timeRemaining);
      }
    } catch (error) {
      console.error('Failed to fetch interview data:', error);
      navigate('/dashboard');
    }
  };

  const startTimer = () => {
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmitResponse();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  };

  const handleNewQuestion = (data) => {
    setCurrentQuestion(data.question);
    setResponse('');
    setAnalysis(null);
    setTimeRemaining(data.question.timeLimit || 300);
  };

  const handleAnalysis = (data) => {
    setAnalysis(data);
    setIsSubmitting(false);
  };

  const handleStatusUpdate = (data) => {
    setInterview(prev => ({
      ...prev,
      scores: data.currentScores,
      status: data.status
    }));
  };

  const handleSubmitResponse = async () => {
    if (!response.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    
    try {
      const submitData = {
        questionId: currentQuestion.id,
        response: response.trim(),
        responseType: 'text',
        timeSpent: (currentQuestion.timeLimit || 300) - timeRemaining,
        confidence: 7 // This could be calculated based on response patterns
      };

      const apiResponse = await fetch(`/api/interviews/${interviewId}/submit-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(submitData)
      });

      const data = await apiResponse.json();
      
      if (data.success) {
        setAnalysis(data.data.realTimeScores);
        
        // Request next question after a delay
        setTimeout(() => {
          if (socket) {
            socket.emit('request-next-question', {
              interviewId,
              analysis: data.data.realTimeScores
            });
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to submit response:', error);
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreColor = (score) => {
    if (score >= 8) return 'text-success-600';
    if (score >= 6.5) return 'text-primary-600';
    if (score >= 5) return 'text-warning-600';
    return 'text-danger-600';
  };

  if (!interview) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Interview Session</h1>
          <p className="text-gray-600">
            {interview.candidate?.name} • {interview.jobRole}
          </p>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Timer */}
          <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg ${
            timeRemaining < 60 ? 'bg-danger-100 text-danger-800' : 'bg-gray-100 text-gray-800'
          }`}>
            <Clock className="h-4 w-4" />
            <span className="font-mono font-medium">{formatTime(timeRemaining)}</span>
          </div>
          
          {/* Media Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsRecording(!isRecording)}
              className={`p-2 rounded-lg ${
                isRecording ? 'bg-danger-600 text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setIsVideoOn(!isVideoOn)}
              className={`p-2 rounded-lg ${
                isVideoOn ? 'bg-gray-200 text-gray-700' : 'bg-gray-400 text-white'
              }`}
            >
              {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <ProgressBar
        current={interview.currentQuestionIndex + 1}
        total={interview.totalQuestions || 10}
        className="mb-6"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Interview Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Question Card */}
          {currentQuestion && (
            <QuestionCard
              question={currentQuestion}
              questionNumber={interview.currentQuestionIndex + 1}
            />
          )}

          {/* Response Area */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Response</h3>
            <textarea
              ref={responseRef}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Type your response here..."
              className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              disabled={isSubmitting}
            />
            
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-500">
                {response.length} characters
              </div>
              
              <button
                onClick={handleSubmitResponse}
                disabled={!response.trim() || isSubmitting}
                className="btn btn-primary flex items-center"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Response
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Real-time Analysis */}
          {analysis && (
            <ResponseAnalysis analysis={analysis} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Live Scores */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Live Scores</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Technical Depth</span>
                <div className="flex items-center space-x-2">
                  <ScoreRing score={interview.scores?.technicalDepth || 0} size="w-12 h-12" />
                  <span className={`font-semibold ${getScoreColor(interview.scores?.technicalDepth || 0)}`}>
                    {(interview.scores?.technicalDepth || 0).toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Consistency</span>
                <div className="flex items-center space-x-2">
                  <ScoreRing score={interview.scores?.consistency || 0} size="w-12 h-12" />
                  <span className={`font-semibold ${getScoreColor(interview.scores?.consistency || 0)}`}>
                    {(interview.scores?.consistency || 0).toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Originality</span>
                <div className="flex items-center space-x-2">
                  <ScoreRing score={interview.scores?.originality || 0} size="w-12 h-12" />
                  <span className={`font-semibold ${getScoreColor(interview.scores?.originality || 0)}`}>
                    {(interview.scores?.originality || 0).toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Practical Knowledge</span>
                <div className="flex items-center space-x-2">
                  <ScoreRing score={interview.scores?.practicalKnowledge || 0} size="w-12 h-12" />
                  <span className={`font-semibold ${getScoreColor(interview.scores?.practicalKnowledge || 0)}`}>
                    {(interview.scores?.practicalKnowledge || 0).toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Red Flags */}
          {interview.redFlags && interview.redFlags.length > 0 && (
            <div className="card">
              <div className="flex items-center space-x-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-danger-600" />
                <h3 className="text-lg font-semibold text-gray-900">Red Flags</h3>
              </div>
              <div className="space-y-2">
                {interview.redFlags.map((flag, index) => (
                  <div key={index} className="flex items-start space-x-2">
                    <div className="w-2 h-2 bg-danger-600 rounded-full mt-2"></div>
                    <p className="text-sm text-gray-700">{flag}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interview Info */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Session Info</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <span className={`score-badge ${
                  interview.status === 'active' ? 'score-good' : 'score-average'
                }`}>
                  {interview.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Difficulty</span>
                <span className="text-sm font-medium">{interview.difficulty}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Duration</span>
                <span className="text-sm font-medium">
                  {Math.floor((Date.now() - new Date(interview.startTime)) / 60000)} min
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewSession;
