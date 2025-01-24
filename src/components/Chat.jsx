import React, { useState, useEffect, useRef } from 'react';
const { ipcRenderer } = window.require('electron');

const MessageTypes = {
  TEXT: 'text',
  WINDOW_SELECTOR: 'window_selector',
  CLASSIFICATION: 'classification',
  USER_COMMAND: 'user_command',
  DEBUG_IMAGE: 'debug_image'
};

const ChatStates = {
  INITIAL: 'initial',
  APP_SELECTION: 'app_selection',
  COMMAND_INPUT: 'command_input',
  PROCESSING: 'processing',
  RESULTS: 'results'
};

function formatAction(action) {
  const parts = [];
  
  // Format the core action
  if (action.action === 'click') {
    parts.push(`Click`);
  } else if (action.action === 'type') {
    parts.push(`Type "${action.input_text}"`);
  } else if (action.action === 'keyboard') {
    parts.push(`Press ${action.key_command}`);
  }

  // Add target information
  if (action.element) {
    parts.push(`on ${action.element.type || 'element'}`);
    if (action.element.text_content) {
      parts.push(`"${action.element.text_content}"`);
    }
  }

  // Add context if available
  if (action.context) {
    parts.push(`(${action.context})`);
  }

  // Add confidence
  parts.push(`[${Math.round(action.confidence * 100)}% confident]`);

  // Add key command if it's part of a type action
  if (action.action === 'type' && action.key_command) {
    parts.push(`then press ${action.key_command}`);
  }

  return parts.join(' ');
}

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [activeWindows, setActiveWindows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWindowId, setSelectedWindowId] = useState(null);
  const [chatState, setChatState] = useState(ChatStates.INITIAL);
  const messagesEndRef = useRef(null);

  // Add initial welcome messages
  useEffect(() => {
    const initializeChat = async () => {
      const welcomeMessages = [
        {
          type: MessageTypes.TEXT,
          content: "👋 Welcome! I'll help you automate your tasks. Let's start by selecting an app to work with.",
          sender: 'system',
          timestamp: new Date().toISOString()
        }
      ];
      setMessages(welcomeMessages);
      setChatState(ChatStates.APP_SELECTION);

      try {
        const windows = await fetchWindows(true);
        const validWindows = windows.filter(w => w.title && w.owner);
        
        if (validWindows.length > 0) {
          setMessages(prev => [
            ...prev,
            {
              type: MessageTypes.WINDOW_SELECTOR,
              content: 'Select an app to automate:',
              sender: 'system',
              windows: validWindows,
              timestamp: new Date().toISOString()
            }
          ]);
        } else {
          setMessages(prev => [
            ...prev,
            {
              type: MessageTypes.TEXT,
              content: "No apps found. Please make sure you've granted screen recording permission.",
              sender: 'system',
              timestamp: new Date().toISOString()
            }
          ]);
        }
      } catch (error) {
        console.error('Error initializing chat:', error);
        setMessages(prev => [
          ...prev,
          {
            type: MessageTypes.TEXT,
            content: "Error loading apps. Please try refreshing.",
            sender: 'system',
            timestamp: new Date().toISOString()
          }
        ]);
      }
    };

    initializeChat();
  }, []);

  const fetchWindows = async (force = false) => {
    if (!force && !isLoading) return;
    
    try {
      const windows = await ipcRenderer.invoke('get-active-windows');
      setActiveWindows(windows);
      setIsLoading(false);
      return windows;
    } catch (error) {
      console.error('Error fetching windows:', error);
      setIsLoading(false);
      return [];
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMessage = {
      type: MessageTypes.USER_COMMAND,
      content: inputValue,
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMessage]);
    const command = inputValue;
    setInputValue('');

    if (chatState === ChatStates.COMMAND_INPUT) {
      setChatState(ChatStates.PROCESSING);
      
      // Add processing message
      setMessages(prev => [...prev, {
        type: MessageTypes.TEXT,
        content: 'Processing your request...',
        sender: 'system',
        timestamp: new Date().toISOString()
      }]);

      try {
        // Analyze and process screen with user's query
        const analysisResult = await ipcRenderer.invoke('analyze-window', selectedWindowId, command);
        
        if (!analysisResult.success) {
          throw new Error(analysisResult.error);
        }

        // Add debug visualization message
        if (analysisResult.debug) {
          setMessages(prev => [
            ...prev,
            {
              type: MessageTypes.DEBUG_IMAGE,
              content: analysisResult.debug,
              sender: 'system',
              timestamp: new Date().toISOString()
            }
          ]);
        }

        // Add action plan message
        if (analysisResult.data.actionPlan) {
          setMessages(prev => [
            ...prev,
            {
              type: MessageTypes.TEXT,
              content: "Here's what I'm going to do:",
              sender: 'system',
              timestamp: new Date().toISOString()
            },
            {
              type: MessageTypes.TEXT,
              content: analysisResult.data.actionPlan.actions.map((action, index) => 
                `${index + 1}. ${formatAction(action)}`
              ).join('\n'),
              sender: 'system',
              timestamp: new Date().toISOString()
            }
          ]);
        }

        setChatState(ChatStates.COMMAND_INPUT);
      } catch (error) {
        console.error('Error processing request:', error);
        setMessages(prev => [...prev, {
          type: MessageTypes.TEXT,
          content: `Error processing request: ${error.message}`,
          sender: 'system',
          timestamp: new Date().toISOString()
        }]);
        setChatState(ChatStates.COMMAND_INPUT);
      }
    }
  };

  const handleWindowSelect = async (windowId) => {
    const selectedWindow = activeWindows.find(w => w.id === windowId);
    setSelectedWindowId(windowId);
    
    try {
      await ipcRenderer.invoke('focus-window', windowId);
      
      setMessages(prev => [
        ...prev,
        {
          type: MessageTypes.TEXT,
          content: `Great! I'll help you automate ${selectedWindow.title}. What would you like to do?`,
          sender: 'system',
          timestamp: new Date().toISOString()
        },
        {
          type: MessageTypes.TEXT,
          content: 'You can tell me what you want to achieve in natural language. For example:\n- "Click the submit button"\n- "Find and fill the search box"\n- "Select the first item in the dropdown"',
          sender: 'system',
          timestamp: new Date().toISOString()
        }
      ]);

      setChatState(ChatStates.COMMAND_INPUT);
    } catch (error) {
      console.error('Error focusing window:', error);
      setMessages(prev => [...prev, {
        type: MessageTypes.TEXT,
        content: `Error focusing on ${selectedWindow.title}. Please try selecting it again.`,
        sender: 'system',
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const renderMessage = (message, index) => {
    switch (message.type) {
      case MessageTypes.WINDOW_SELECTOR:
        return (
          <div key={index} className="message system-message window-selector">
            <p>{message.content}</p>
            <div className="window-options">
              {message.windows.map(window => (
                <button
                  key={window.id}
                  onClick={() => handleWindowSelect(window.id)}
                  className="window-option"
                >
                  <div className="window-option-content">
                    <span className="app-name">{window.owner.name}</span>
                    <span className="window-title">{window.title}</span>
                    <span className="window-info">
                      {window.bounds.width}x{window.bounds.height}
                      {window.url && <span className="window-url"> • {window.url}</span>}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case MessageTypes.DEBUG_IMAGE:
        return (
          <div key={index} className="message system-message debug-image">
            <button
              className="view-debug-button"
              onClick={() => {
                const debugWindow = window.open('', '_blank', 'width=1200,height=800');
                debugWindow.document.write(`
                  <html>
                    <head>
                      <title>Debug Visualization</title>
                      <style>
                        body {
                          margin: 0;
                          padding: 20px;
                          background: #1a1a1a;
                          color: #fff;
                          font-family: system-ui, -apple-system, sans-serif;
                        }
                        .container {
                          display: flex;
                          flex-direction: column;
                          gap: 20px;
                        }
                        .section {
                          display: flex;
                          gap: 20px;
                        }
                        .image-container {
                          flex: 1;
                        }
                        .image-container img {
                          max-width: 100%;
                          height: auto;
                        }
                        .classifications {
                          flex: 1;
                          overflow-y: auto;
                          max-height: calc(100vh - 40px);
                        }
                        .classification-item {
                          background: #2a2a2a;
                          padding: 10px;
                          margin-bottom: 10px;
                          border-radius: 4px;
                        }
                        pre {
                          white-space: pre-wrap;
                          word-wrap: break-word;
                        }
                      </style>
                    </head>
                    <body>
                      <div class="container">
                        <div class="section">
                          <div class="image-container">
                            <img src="${URL.createObjectURL(new Blob([message.content.visualizationBuffer], { type: 'image/png' }))}" 
                                 alt="Debug visualization" />
                          </div>
                          <div class="classifications">
                            <h2>Classifications</h2>
                            ${message.content.classifications.map(c => `
                              <div class="classification-item">
                                <strong>Index: ${c.index}</strong><br/>
                                Type: ${c.type || 'N/A'}<br/>
                                Text: ${c.text || 'N/A'}<br/>
                                <pre>${JSON.stringify(c.metadata, null, 2)}</pre>
                              </div>
                            `).join('')}
                          </div>
                        </div>
                      </div>
                    </body>
                  </html>
                `);
              }}
            >
              View Debug Visualization
            </button>
          </div>
        );

      default:
        return (
          <div key={index} className={`message ${message.sender}-message`}>
            <p>{message.content}</p>
          </div>
        );
    }
  };

  return (
    <div className="chat-container">
      <div className="messages-wrapper">
        <div className="messages">
          {messages.map((message, index) => renderMessage(message, index))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="input-container">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder={
            chatState === ChatStates.APP_SELECTION
              ? "Or type an app name..."
              : chatState === ChatStates.COMMAND_INPUT
              ? "What would you like me to do?"
              : chatState === ChatStates.PROCESSING
              ? "Processing..."
              : "Type a message..."
          }
          disabled={chatState === ChatStates.PROCESSING}
        />
        <button onClick={handleSend} disabled={chatState === ChatStates.PROCESSING}>
          Send
        </button>
      </div>
    </div>
  );
};

export default Chat; 