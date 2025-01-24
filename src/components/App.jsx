import React, { useState } from 'react';
import Chat from './Chat';
import Settings from './Settings';

const App = () => {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="app-container">
      <div className="tab-bar">
        <button
          className={`tab-button ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>
      
      <div className="content">
        {activeTab === 'chat' ? <Chat /> : <Settings />}
      </div>
    </div>
  );
};

export default App; 