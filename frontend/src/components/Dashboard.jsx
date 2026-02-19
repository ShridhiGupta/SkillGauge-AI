import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Users, 
  TrendingUp, 
  AlertTriangle, 
  Clock, 
  Award,
  Activity,
  BarChart3,
  Eye
} from 'lucide-react';
import ScoreRing from './ui/ScoreRing';
import StatsCard from './ui/StatsCard';
import RecentInterviews from './ui/RecentInterviews';
import RedFlagAlert from './ui/RedFlagAlert';

const Dashboard = ({ socket }) => {
  const [stats, setStats] = useState({
    totalInterviews: 0,
    averageScore: 0,
    redFlags: 0,
    activeInterviews: 0
  });
  const [recentInterviews, setRecentInterviews] = useState([]);
  const [redFlags, setRedFlags] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    
    if (socket) {
      socket.on('interview-update', handleInterviewUpdate);
      socket.on('red-flag-detected', handleRedFlag);
      
      return () => {
        socket.off('interview-update', handleInterviewUpdate);
        socket.off('red-flag-detected', handleRedFlag);
      };
    }
  }, [socket]);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, interviewsRes, flagsRes] = await Promise.all([
        fetch('/api/dashboard/stats', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }),
        fetch('/api/dashboard/recent-interviews', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }),
        fetch('/api/dashboard/red-flags', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
      ]);

      const statsData = await statsRes.json();
      const interviewsData = await interviewsRes.json();
      const flagsData = await flagsRes.json();

      if (statsData.success) setStats(statsData.data);
      if (interviewsData.success) setRecentInterviews(interviewsData.data);
      if (flagsData.success) setRedFlags(flagsData.data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInterviewUpdate = (data) => {
    setStats(prev => ({
      ...prev,
      activeInterviews: data.activeInterviews,
      averageScore: data.newAverage
    }));
  };

  const handleRedFlag = (flag) => {
    setRedFlags(prev => [flag, ...prev.slice(0, 4)]);
    setStats(prev => ({ ...prev, redFlags: prev.redFlags + 1 }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Interview Dashboard</h1>
        <p className="mt-2 text-gray-600">Monitor interview integrity and candidate authenticity</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Interviews"
          value={stats.totalInterviews}
          icon={Users}
          color="primary"
          trend="+12%"
        />
        <StatsCard
          title="Average Score"
          value={stats.averageScore.toFixed(1)}
          icon={TrendingUp}
          color="success"
          trend="+5%"
          isScore
        />
        <StatsCard
          title="Red Flags"
          value={stats.redFlags}
          icon={AlertTriangle}
          color="danger"
          trend="+2"
        />
        <StatsCard
          title="Active Sessions"
          value={stats.activeInterviews}
          icon={Activity}
          color="primary"
          trend="Live"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Score Overview & Recent Interviews */}
        <div className="lg:col-span-2 space-y-6">
          {/* Score Overview */}
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Score Distribution</h2>
              <Link
                to="/analytics"
                className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center"
              >
                <BarChart3 className="h-4 w-4 mr-1" />
                View Analytics
              </Link>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <ScoreRing score={85} size="w-20 h-20" />
                <p className="mt-2 text-sm font-medium text-gray-900">Technical Depth</p>
                <p className="text-xs text-gray-500">Excellent</p>
              </div>
              <div className="text-center">
                <ScoreRing score={72} size="w-20 h-20" />
                <p className="mt-2 text-sm font-medium text-gray-900">Consistency</p>
                <p className="text-xs text-gray-500">Good</p>
              </div>
              <div className="text-center">
                <ScoreRing score={68} size="w-20 h-20" />
                <p className="mt-2 text-sm font-medium text-gray-900">Originality</p>
                <p className="text-xs text-gray-500">Average</p>
              </div>
              <div className="text-center">
                <ScoreRing score={79} size="w-20 h-20" />
                <p className="mt-2 text-sm font-medium text-gray-900">Practical Knowledge</p>
                <p className="text-xs text-gray-500">Good</p>
              </div>
            </div>
          </div>

          {/* Recent Interviews */}
          <RecentInterviews interviews={recentInterviews} />
        </div>

        {/* Right Column - Quick Actions & Red Flags */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Link
                to="/interview/new"
                className="btn btn-primary w-full justify-center"
              >
                <Users className="h-4 w-4 mr-2" />
                Start New Interview
              </Link>
              <Link
                to="/candidates"
                className="btn btn-secondary w-full justify-center"
              >
                <Eye className="h-4 w-4 mr-2" />
                View Candidates
              </Link>
              <Link
                to="/analytics"
                className="btn btn-secondary w-full justify-center"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Analytics
              </Link>
            </div>
          </div>

          {/* Red Flags Alert */}
          {redFlags.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Recent Red Flags</h2>
                <span className="score-badge score-poor">
                  {redFlags.length} Active
                </span>
              </div>
              <div className="space-y-3 max-h-64 overflow-y-auto scrollbar-thin">
                {redFlags.map((flag, index) => (
                  <RedFlagAlert key={index} flag={flag} />
                ))}
              </div>
            </div>
          )}

          {/* System Status */}
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">System Status</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">AI Engine</span>
                <span className="score-badge score-excellent">Online</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">LLM Service</span>
                <span className="score-badge score-excellent">Healthy</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Database</span>
                <span className="score-badge score-excellent">Connected</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Last Sync</span>
                <span className="text-xs text-gray-500">2 min ago</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
