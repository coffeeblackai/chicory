import React, { useState, useEffect } from 'react';

const Stats = () => {
  const [healthStatus, setHealthStatus] = useState(null);
  const [error, setError] = useState(null);

  const fetchHealthStatus = async () => {
    try {
      const response = await fetch('http://104.171.203.26:8000/health');
      const data = await response.json();
      setHealthStatus(data);
      setError(null);
    } catch (err) {
      setError('Connection failed');
      console.error('Error checking health:', err);
    }
  };

  useEffect(() => {
    fetchHealthStatus();
    const interval = setInterval(fetchHealthStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="stats-error">
        <p>{error}</p>
      </div>
    );
  }

  if (!healthStatus) {
    return (
      <div className="stats-loading">
        <p>Connecting to service...</p>
      </div>
    );
  }

  return (
    <div className="stats-container">
      <div className="model-status-item">
        <div className="model-status-header">
          <span className="model-name">DETECTION SERVICE</span>
          <span className={`model-badge ${healthStatus.status === 'healthy' ? 'success' : 'error'}`}>
            {healthStatus.status === 'healthy' ? 'CONNECTED' : 'ERROR'}
          </span>
        </div>
        <div className="detection-metrics">
          <div>YOLO Model: {healthStatus.components.yolo_model}</div>
          <div>CLIP Model: {healthStatus.components.clip_model}</div>
          <div>GPU: {healthStatus.components.gpu_available ? 'Available (CUDA)' : 'Not Available'}</div>
          <div>Database: {healthStatus.components.aperturedb}</div>
        </div>
      </div>
    </div>
  );
};

export default Stats; 