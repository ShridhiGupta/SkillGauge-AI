import React from 'react';

const ScoreRing = ({ score, size = "w-16 h-16", strokeWidth = 4 }) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 10) * circumference;
  
  const getColor = (score) => {
    if (score >= 8) return '#10b981'; // success-500
    if (score >= 6.5) return '#3b82f6'; // primary-500
    if (score >= 5) return '#f59e0b'; // warning-500
    return '#ef4444'; // danger-500
  };

  return (
    <div className={`${size} relative inline-flex items-center justify-center`}>
      <svg
        className="progress-ring"
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
      >
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={getColor(score)}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-gray-900">
          {score.toFixed(1)}
        </span>
      </div>
    </div>
  );
};

export default ScoreRing;
