import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Dashboard from './components/Dashboard';
import InterviewSession from './components/InterviewSession';
import CandidateManagement from './components/CandidateManagement';
import Login from './components/Login';
import Header from './components/Header';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './index.css';

function AppRoutes() {
  const { user, loading } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (user) {
      const newSocket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:3001', {
        auth: {
          token: localStorage.getItem('token')
        }
      });
      
      setSocket(newSocket);
      
      return () => newSocket.close();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {user && <Header socket={socket} />}
        <main className={user ? "pt-16" : ""}>
          <Routes>
            <Route 
              path="/login" 
              element={!user ? <Login /> : <Navigate to="/dashboard" />} 
            />
            <Route 
              path="/dashboard" 
              element={user ? <Dashboard socket={socket} /> : <Navigate to="/login" />} 
            />
            <Route 
              path="/interview/:interviewId" 
              element={user ? <InterviewSession socket={socket} /> : <Navigate to="/login" />} 
            />
            <Route 
              path="/candidates" 
              element={user ? <CandidateManagement /> : <Navigate to="/login" />} 
            />
            <Route 
              path="/" 
              element={<Navigate to={user ? "/dashboard" : "/login"} />} 
            />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
