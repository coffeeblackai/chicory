import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');

const Settings = () => {
  const [monitors, setMonitors] = useState([]);
  const [selectedMonitor, setSelectedMonitor] = useState(null);
  const [activeWindows, setActiveWindows] = useState([]);
  const [isIntelligentMode, setIsIntelligentMode] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        // Get monitor info
        const monitorInfo = await ipcRenderer.invoke('get-monitors');
        setMonitors(monitorInfo);
        // Default to primary monitor
        const primaryMonitor = monitorInfo.find(m => m.isPrimary);
        if (primaryMonitor) setSelectedMonitor(primaryMonitor.id);

        // Get window info
        const windows = await ipcRenderer.invoke('get-active-windows');
        setActiveWindows(windows);

        // Get intelligent mode state
        const intelligentMode = await ipcRenderer.invoke('get-intelligent-mode');
        setIsIntelligentMode(intelligentMode);
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };

    fetchSettings();

    // Listen for mode changes from other parts of the app
    const handleModeChange = (event, newMode) => {
      console.log('Mode changed:', newMode);
      setIsIntelligentMode(newMode);
    };

    ipcRenderer.on('intelligent-mode-changed', handleModeChange);

    return () => {
      ipcRenderer.removeListener('intelligent-mode-changed', handleModeChange);
    };
  }, []);

  const handleModeToggle = async () => {
    try {
      const newMode = !isIntelligentMode;
      console.log('Toggling mode to:', newMode);
      await ipcRenderer.invoke('set-intelligent-mode', newMode);
      setIsIntelligentMode(newMode);
    } catch (error) {
      console.error('Error toggling mode:', error);
      // Revert UI state if the toggle failed
      setIsIntelligentMode(!newMode);
    }
  };

  return (
    <div className="settings-container">
      <h2>Settings</h2>
      
      <div className="settings-content">
        <section className="mode-settings">
          <h3>Processing Mode</h3>
          <div className="mode-toggle">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={isIntelligentMode}
                onChange={handleModeToggle}
              />
              <span className="toggle-slider"></span>
            </label>
            <span className="mode-label">
              {isIntelligentMode ? 'Intelligent Mode' : 'Efficient Mode'}
            </span>
            <p className="mode-description">
              {isIntelligentMode 
                ? 'Process each element individually for more precise control (slower)'
                : 'Process all elements at once for faster response (default)'}
            </p>
          </div>
        </section>

        <section className="monitor-settings">
          <h3>Select Active Monitor</h3>
          <div className="monitor-list">
            {monitors.map((monitor) => (
              <div
                key={monitor.id}
                className={`monitor-item ${selectedMonitor === monitor.id ? 'selected' : ''}`}
                onClick={() => setSelectedMonitor(monitor.id)}
              >
                <div className="monitor-preview" style={{
                  aspectRatio: `${monitor.size.width} / ${monitor.size.height}`,
                  width: '100px'
                }}>
                  {monitor.isPrimary && <span className="primary-badge">Primary</span>}
                </div>
                <div className="monitor-info">
                  <p>Monitor {monitor.id + 1}</p>
                  <p>{monitor.size.width} x {monitor.size.height}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="window-list">
          <h3>Active Windows</h3>
          <div className="windows">
            {activeWindows.map((window) => (
              <div key={window.id} className="window-item">
                <div className="window-item-content">
                  <span className="window-title">{window.title}</span>
                  <span className="window-app">{window.owner.name}</span>
                </div>
                <span className="window-status">
                  {window.isMinimized ? 'Minimized' : 'Active'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings; 