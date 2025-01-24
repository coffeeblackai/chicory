require('dotenv').config();
const { app, BrowserWindow, Tray, screen, nativeTheme, nativeImage, ipcMain, systemPreferences, dialog, desktopCapturer } = require('electron');
const path = require('path');
const activeWin = require('active-win');
const fs = require('fs');
const { spawn } = require('child_process');
require('@electron/remote/main').initialize();
const { analyzeElements } = require('./api_client');
const { executeActions } = require('./actions');

// Validate required environment variables
if (!process.env.API_ENDPOINT) {
  console.error('Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

let tray = null;
let mainWindow = null;
let cachedIcon = null;
let isCheckingPermission = false;
let hasPermission = false;
let cachedWindows = null;
let windowRefreshInterval = null;
let pythonProcess = null;
let isIntelligentMode = true;
let isInitialPermissionCheck = true;

// Function to start Python automation service
async function startPythonService() {
  return new Promise((resolve, reject) => {
    try {
      console.log('Starting Python automation service...');
      
      // Get the Python executable path
      const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
      
      // Spawn Python process
      pythonProcess = spawn(pythonPath, [path.join(__dirname, 'automation_service.py')], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle Python process output
      pythonProcess.stdout.on('data', (data) => {
        console.log('Python service:', data.toString());
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error('Python service error:', data.toString());
      });

      pythonProcess.on('error', (error) => {
        console.error('Failed to start Python service:', error);
        reject(error);
      });

      // Check if process started successfully
      pythonProcess.on('spawn', () => {
        console.log('Python service started with PID:', pythonProcess.pid);
        
        // Wait a moment for the service to be ready
        setTimeout(() => {
          resolve(true);
        }, 1000);
      });

      // Handle unexpected exit
      pythonProcess.on('exit', (code, signal) => {
        if (code !== null) {
          console.error(`Python service exited with code ${code}`);
        } else if (signal !== null) {
          console.error(`Python service was killed with signal ${signal}`);
        }
        
        // Only restart if app is not quitting
        if (!app.isQuitting) {
          console.log('Attempting to restart Python service...');
          startPythonService().catch(console.error);
        }
      });
    } catch (error) {
      console.error('Error starting Python service:', error);
      reject(error);
    }
  });
}

// Function to stop Python service
function stopPythonService() {
  return new Promise((resolve) => {
    if (pythonProcess) {
      console.log('Stopping Python service...');
      
      // Set a timeout to force kill if graceful shutdown fails
      const forceKillTimeout = setTimeout(() => {
        if (pythonProcess) {
          console.log('Force killing Python service...');
          pythonProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      // Try graceful shutdown first
      pythonProcess.on('exit', () => {
        clearTimeout(forceKillTimeout);
        pythonProcess = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      pythonProcess.kill('SIGTERM');
    } else {
      resolve();
    }
  });
}

function getIconPath() {
  try {
    // Use cached icon if available and theme hasn't changed
    if (cachedIcon) return cachedIcon;

    const iconName = nativeTheme.shouldUseDarkColors ? 'icon-white.png' : 'icon-black.png';
    const iconPath = path.join(__dirname, 'icons', iconName);
    console.log('Loading icon from:', iconPath);
    
    if (!require('fs').existsSync(iconPath)) {
      console.error('Icon file not found:', iconPath);
      // Fallback to black icon if the preferred one isn't found
      const fallbackPath = path.join(__dirname, 'icons', 'icon-black.png');
      if (require('fs').existsSync(fallbackPath)) {
        console.log('Using fallback icon:', fallbackPath);
        cachedIcon = nativeImage.createFromPath(fallbackPath).resize({ width: 36, height: 36 });
        return cachedIcon;
      }
      throw new Error('No icon files found');
    }
    
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      throw new Error('Failed to load icon image');
    }
    cachedIcon = icon.resize({ width: 36, height: 36 });
    return cachedIcon;
  } catch (error) {
    console.error('Error loading icon:', error);
    // Return a default empty image rather than crashing
    return nativeImage.createEmpty();
  }
}

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    show: true,
    frame: false,
    resizable: false,
    transparent: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('src/index.html');
  require("@electron/remote/main").enable(mainWindow.webContents);

  const windowBounds = mainWindow.getBounds();
  const position = { x: screenWidth - windowBounds.width, y: 0 };
  console.log('Setting window position:', position);
  mainWindow.setPosition(position.x, position.y);

  // Check permission once when the window content is loaded
  mainWindow.webContents.once('did-finish-load', async () => {
    await checkScreenRecordingPermission(true);
  });
}

function createTray() {
  tray = new Tray(getIconPath());
  
  // Only update icon when theme actually changes
  nativeTheme.on('updated', () => {
    cachedIcon = null; // Clear cache when theme changes
    tray.setImage(getIconPath());
  });
  
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      const trayBounds = tray.getBounds();
      const windowBounds = mainWindow.getBounds();
      
      // Calculate position
      let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
      let y = process.platform === 'darwin' ? trayBounds.y + trayBounds.height + 4 : trayBounds.y;
      
      // Ensure window is visible on screen
      const display = screen.getPrimaryDisplay();
      const screenBounds = display.workArea;
      
      // Keep window within screen bounds
      x = Math.max(screenBounds.x, Math.min(x, screenBounds.x + screenBounds.width - windowBounds.width));
      y = Math.max(screenBounds.y, Math.min(y, screenBounds.y + screenBounds.height - windowBounds.height));
      
      console.log('Tray bounds:', trayBounds);
      console.log('Window position:', { x, y });
      
      mainWindow.setPosition(x, y);
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getMonitorInfo() {
  const displays = screen.getAllDisplays();
  return displays.map((display, index) => ({
    id: index,
    bounds: display.bounds,
    workArea: display.workArea,
    size: display.size,
    isPrimary: display.id === screen.getPrimaryDisplay().id
  }));
}

async function checkScreenRecordingPermission(shouldShowDialog = true) {
  if (process.platform !== 'darwin') return true;
  if (isCheckingPermission) return false;
  if (hasPermission) return true;

  try {
    isCheckingPermission = true;
    const windows = await activeWin.getOpenWindows();
    
    if (Array.isArray(windows) && windows.length > 0) {
      const hasValidWindows = windows.some(win => 
        win.title && win.owner && win.owner.name && win.bounds
      );

      if (hasValidWindows) {
        hasPermission = true;
        isCheckingPermission = false;
        
        if (!windowRefreshInterval) {
          startWindowRefresh();
        }
        
        // Notify UI of permission granted and send initial window list
        if (mainWindow) {
          mainWindow.webContents.send('permission-granted');
          mainWindow.webContents.send('window-list-updated', windows);
        }
        
        return true;
      }
    }
    
    hasPermission = false;
    
    if (shouldShowDialog && mainWindow) {
      // Only show the welcome message on first check
      if (isInitialPermissionCheck) {
        mainWindow.webContents.send('chat-message', {
          role: 'assistant',
          content: 'Welcome! I\'ll help you automate your tasks. First, I\'ll need screen recording permission to detect windows.'
        });
        isInitialPermissionCheck = false;
      }
      
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Open System Settings', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Screen Recording Permission Required',
        message: 'Chicory needs screen recording permission to detect windows',
        detail: 'This permission is required to interact with other applications. Your privacy is important to us - this permission will only be used to detect window information.',
        icon: getIconPath()
      });

      if (response === 0) {
        require('child_process').exec('open x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        
        setTimeout(async () => {
          const permissionGranted = await checkScreenRecordingPermission(false);
          if (permissionGranted) {
            const windows = await getActiveWindows();
            mainWindow.webContents.send('window-list-updated', windows);
          }
        }, 3000);
      }
    }
    
    isCheckingPermission = false;
    return false;
  } catch (error) {
    console.error('Permission check failed:', error);
    hasPermission = false;
    isCheckingPermission = false;
    return false;
  }
}

async function getActiveWindows() {
  if (isCheckingPermission) {
    return cachedWindows || [];
  }

  try {
    if (!hasPermission) {
      const permissionGranted = await checkScreenRecordingPermission(false);
      if (!permissionGranted) {
        return [];
      }
    }

    const windows = await activeWin.getOpenWindows();
    
    if (!Array.isArray(windows) || windows.length === 0) {
      return [];
    }

    const validWindows = windows.filter(win => 
      win && win.title && win.owner && win.owner.name && win.bounds
    );

    if (validWindows.length > 0) {
      cachedWindows = validWindows;
      // Update UI with new window list
      mainWindow?.webContents.send('window-list-updated', validWindows);
    }

    return validWindows;
  } catch (error) {
    console.error('Error getting active windows:', error);
    return cachedWindows || [];
  }
}

async function captureWindow(windowId) {
  try {
    const windows = await activeWin.getOpenWindows();
    const targetWindow = windows.find(w => w.id === windowId);
    
    if (!targetWindow) {
      throw new Error('Window not found');
    }

    // Get the display where the window is located
    const windowCenter = {
      x: targetWindow.bounds.x + targetWindow.bounds.width / 2,
      y: targetWindow.bounds.y + targetWindow.bounds.height / 2
    };
    const display = screen.getDisplayNearestPoint(windowCenter);
    const scaleFactor = display.scaleFactor || 1;

    console.log('Display scale factor:', scaleFactor);
    console.log('Window bounds:', targetWindow.bounds);

    // Store current window state
    const chicoryWindow = mainWindow;
    const wasChicoryFocused = chicoryWindow.isFocused();

    try {
      // Focus the target window
      if (process.platform === 'darwin') {
        const script = `
          tell application "System Events"
            set frontmost of the first process whose unix id is ${targetWindow.owner.processId} to true
          end tell
        `;
        require('child_process').execSync(`osascript -e '${script}'`);
      }

      // Small delay to ensure window focus has changed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get all screen sources with proper scaling
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.size.width * scaleFactor,
          height: display.size.height * scaleFactor
        }
      });

      if (!sources.length) {
        throw new Error('No screen sources found');
      }

      // Get the primary display source
      const primarySource = sources[0];
      const image = primarySource.thumbnail;
      
      // Crop the image to the window bounds, accounting for scale factor
      const bounds = {
        x: targetWindow.bounds.x * scaleFactor,
        y: targetWindow.bounds.y * scaleFactor,
        width: targetWindow.bounds.width * scaleFactor,
        height: targetWindow.bounds.height * scaleFactor
      };

      console.log('Scaled bounds for cropping:', bounds);

      // Create a canvas to draw the screenshot
      const { createCanvas } = require('canvas');
      const canvas = createCanvas(bounds.width, bounds.height);
      const ctx = canvas.getContext('2d');

      // First crop to target window bounds
      const croppedImage = image.crop(bounds);

      // Convert NativeImage to Buffer
      const imageBuffer = croppedImage.toPNG();

      // Create an Image from the buffer
      const img = new (require('canvas').Image)();
      img.src = imageBuffer;

      // Draw the image onto the canvas
      ctx.drawImage(img, 0, 0);

      // Convert to PNG buffer
      const pngBuffer = canvas.toBuffer('image/png');

      return {
        buffer: pngBuffer,
        windowInfo: {
          title: targetWindow.title,
          owner: targetWindow.owner,
          url: targetWindow.url,
          bounds: targetWindow.bounds,
          scaleFactor: scaleFactor
        }
      };
    } finally {
      // Restore Chicory window focus if it was focused before
      if (wasChicoryFocused) {
        chicoryWindow.focus();
      }
    }
  } catch (error) {
    console.error('Error capturing window:', error);
    throw error;
  }
}

function startWindowRefresh() {
  if (windowRefreshInterval) {
    clearInterval(windowRefreshInterval);
  }

  windowRefreshInterval = setInterval(async () => {
    if (hasPermission && !isCheckingPermission) {
      cachedWindows = null;
      const windows = await getActiveWindows();
      if (windows.length > 0) {
        mainWindow?.webContents.send('window-list-updated', windows);
      }
    }
  }, 5000);
}

function stopWindowRefresh() {
  if (windowRefreshInterval) {
    clearInterval(windowRefreshInterval);
    windowRefreshInterval = null;
  }
}

// Set up IPC handlers
ipcMain.handle('get-monitors', () => {
  return getMonitorInfo();
});

ipcMain.handle('get-active-windows', async () => {
  return await getActiveWindows();
});

ipcMain.handle('focus-window', async (event, windowId) => {
  try {
    const windows = await activeWin.getOpenWindows();
    const targetWindow = windows.find(w => w.id === windowId);
    
    if (!targetWindow) {
      throw new Error('Window not found');
    }

    // On macOS, we can use the process ID to focus the window
    if (process.platform === 'darwin') {
      const script = `
        tell application "System Events"
          set frontmost of the first process whose unix id is ${targetWindow.owner.processId} to true
        end tell
      `;
      require('child_process').execSync(`osascript -e '${script}'`);
    }
    
    return true;
  } catch (error) {
    console.error('Error focusing window:', error);
    throw error;
  }
});

// Add cleanup handlers
app.on('before-quit', async (event) => {
  event.preventDefault();
  app.isQuitting = true;
  
  stopWindowRefresh();
  await stopPythonService();
  
  app.exit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Add IPC handler for toggling mode
ipcMain.handle('toggle-mode', (event, intelligent) => {
  isIntelligentMode = intelligent;
  return isIntelligentMode;
});

// Add IPC handler for analyzing windows
ipcMain.handle('analyze-window', async (event, windowId, query) => {
  try {
    console.log('Starting window analysis for:', windowId, 'with query:', query);
    const captureData = await captureWindow(windowId);
    
    // Create debug directory for this session
    const debugDir = path.join(__dirname, '..', 'debug');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = path.join(debugDir, timestamp);
    
    try {
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir);
      }
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir);
      }
    } catch (error) {
      console.error('Error creating debug directories:', error);
    }

    // Call the reason_screenshot endpoint
    const formData = new FormData();
    formData.append('query', query);
    formData.append('file', new Blob([captureData.buffer], { type: 'image/png' }), 'screenshot.png');
    
    console.log('Sending reason request...');
    const response = await fetch('https://app.coffeeblack.ai/api/reason_screenshot', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Reason request failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Reason result:', JSON.stringify(result, null, 2));

    // Save API response for debugging
    try {
      const responsePath = path.join(sessionDir, 'api_response.json');
      fs.writeFileSync(responsePath, JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error saving API response:', error);
    }

    // Process actions if any
    if (result.actions && result.actions.length > 0) {
      // Map each action to include element_index and key_command
      let processedActions = result.actions.map(action => ({
        ...action,
        element_index: action.element_index || null,
        key_command: action.key_command || null,
        mesh_id: action.mesh_id || null,
        confidence: action.confidence || result.confidence || 0
      }));

      // Handle scroll actions
      const scrollActions = processedActions.filter(action => action.action === 'scroll');
      if (scrollActions.length > 0) {
        let scrollCount = 0;
        const maxScrolls = 5;

        // Calculate center of window for scrolling
        const windowCenter = {
          x: Math.round(captureData.windowInfo.bounds.width / 2),
          y: Math.round(captureData.windowInfo.bounds.height / 2)
        };

        // Create a centered scroll action
        const centeredScrollAction = {
          action: 'scroll',
          scroll_direction: scrollActions[0].scroll_direction || 'down',
          element_index: null,
          mesh_id: null,
          bbox: {
            window: {
              x: windowCenter.x,
              y: windowCenter.y,
              width: 1,
              height: 1
            },
            screen: {
              x: windowCenter.x + (captureData.windowInfo.bounds?.x || 0),
              y: windowCenter.y + (captureData.windowInfo.bounds?.y || 0),
              width: 1,
              height: 1
            }
          }
        };

        while (scrollCount < maxScrolls) {
          // Execute single scroll action at window center
          await executeActions([centeredScrollAction], [], captureData.windowInfo);
          
          // Wait for content to settle
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Take new screenshot
          const newCaptureData = await captureWindow(windowId);
          
          // Save debug info
          fs.writeFileSync(
            path.join(sessionDir, `scroll_${scrollCount}.png`),
            newCaptureData.buffer
          );
          
          scrollCount++;
        }
        
        if (scrollCount >= maxScrolls) {
          console.log('Reached maximum scroll limit');
        }

        // Remove scroll actions from processedActions since we've handled them
        processedActions = processedActions.filter(action => action.action !== 'scroll');
      }

      // Execute remaining non-scroll actions
      if (processedActions.length > 0) {
        await executeActions(processedActions, result.boxes || [], captureData.windowInfo);
      }

      // Send element details to chat before executing actions
      const actionDetails = processedActions.map(action => {
        const element = result.boxes?.find(b => b.mesh_id === action.mesh_id) || null;

        return {
          action: action.action,
          input_text: action.input_text,
          key_command: action.key_command,
          confidence: action.confidence,
          element: element ? {
            mesh_id: element.mesh_id,
            bbox: element.bbox
          } : null
        };
      });

      // Send both the plan and detailed element info to chat
      mainWindow.webContents.send('chat-message', {
        role: 'assistant',
        content: `Here's what I'm going to do:\n\n${result.explanation || ''}\n\nDetailed action plan:\n${actionDetails.map(detail => {
          const elementInfo = detail.element ? 
            `\nTarget Element ${detail.element.mesh_id}:
             - Location: Window(${detail.element.bbox?.window?.x}, ${detail.element.bbox?.window?.y}), Screen(${detail.element.bbox?.screen?.x}, ${detail.element.bbox?.screen?.y})
             - Size: ${detail.element.bbox?.window?.width}x${detail.element.bbox?.window?.height}
             - Confidence: ${(detail.confidence * 100).toFixed(1)}%` : 
            'No target element';
          
          return `• ${detail.action.toUpperCase()}${detail.input_text ? ` "${detail.input_text}"` : ''}${detail.key_command ? ` [${detail.key_command}]` : ''}${elementInfo}`;
        }).join('\n\n')}`
      });
    }

    // Create debug visualization
    console.log('Creating debug visualization...');
    const debugData = await createDebugVisualization(
      captureData.buffer,
      result.boxes || [],
      captureData.windowInfo,
      true
    );

    console.log('Debug visualization created');

    return {
      success: true,
      data: result,
      windowInfo: captureData.windowInfo,
      debug: {
        visualizationBuffer: debugData.debugImage,
        classifications: result.boxes?.map(box => ({
          mesh_id: box.mesh_id,
          bbox: box.bbox,
          confidence: box.confidence || 0,
          action: box.action || null
        })) || []
      }
    };
  } catch (error) {
    console.error('Error analyzing window:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Add debug visualization function
async function createDebugVisualization(imageBuffer, boxes, windowInfo, preserveIndices = false) {
  const { createCanvas, loadImage } = require('canvas');
  const fs = require('fs');
  const path = require('path');
  
  // Create debug directory if it doesn't exist
  const debugDir = path.join(__dirname, '..', 'debug');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionDir = path.join(debugDir, timestamp);
  
  try {
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }
    fs.mkdirSync(sessionDir);
  } catch (error) {
    console.error('Error creating debug directories:', error);
  }
  
  // Load the screenshot into a canvas
  const image = await loadImage(imageBuffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  
  console.log('Debug: Canvas dimensions:', { width: canvas.width, height: canvas.height });
  console.log('Debug: Window info:', windowInfo);
  
  // Draw the original image
  ctx.drawImage(image, 0, 0);
  
  // Save original screenshot
  fs.writeFileSync(path.join(sessionDir, 'original.png'), imageBuffer);
  
  // Draw boxes and labels
  ctx.lineWidth = 2;
  ctx.font = '14px Arial';
  
  console.log('Debug: Processing', boxes.length, 'boxes');
  
  // Get window offset from the windowInfo (for screen coordinate calculations only)
  const windowX = windowInfo.bounds?.x || 0;
  const windowY = windowInfo.bounds?.y || 0;
  
  boxes.forEach((box, arrayIndex) => {
    // Use original index if preserving indices, otherwise use array index
    const displayIndex = preserveIndices && box.originalIndex !== undefined ? box.originalIndex : arrayIndex;
    
    console.log(`\nDebug: Processing box ${displayIndex}:`);
    
    // Get coordinates from the box data
    let x, y, width, height;
    let coordinateSource = 'unknown';
    
    // First try to get coordinates from bbox
    if (box.bbox?.window) {
      x = box.bbox.window.x;
      y = box.bbox.window.y;
      width = box.bbox.window.width;
      height = box.bbox.window.height;
      coordinateSource = 'bbox.window';
    }
    // Then try mesh at root level
    else if (box.mesh) {
      x = box.mesh.x;
      y = box.mesh.y;
      width = box.mesh.width;
      height = box.mesh.height;
      coordinateSource = 'root.mesh';
    } else {
      console.error('Invalid bbox format for box:', box);
      return; // Skip this box
    }
    
    console.log('Debug: Original coordinates:', { 
      source: coordinateSource,
      window: { x, y, width, height },
      screen: { x: x + windowX, y: y + windowY, width, height }
    });
    
    // Validate coordinates are within the window bounds
    if (x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height) {
      console.log('Debug: Box extends outside window bounds, clamping coordinates');
      x = Math.max(0, Math.min(x, canvas.width));
      y = Math.max(0, Math.min(y, canvas.height));
      width = Math.min(width, canvas.width - x);
      height = Math.min(height, canvas.height - y);
    }
    
    // Validate coordinates
    if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
      console.error('Invalid coordinates (NaN detected):', { x, y, width, height });
      return;
    }
    
    if (width <= 0 || height <= 0) {
      console.error('Invalid dimensions (zero or negative):', { width, height });
      return;
    }
    
    // Generate color based on confidence if available
    let color;
    if (box.confidence !== undefined) {
      // Green for high confidence, yellow for medium, red for low
      const hue = box.confidence * 120; // 0 = red, 60 = yellow, 120 = green
      color = `hsl(${hue}, 70%, 50%)`;
    } else {
      // Generate a random color if no confidence score
      const hue = (displayIndex * 137.508) % 360;
      color = `hsl(${hue}, 70%, 50%)`;
    }
    
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    
    console.log('Debug: Drawing box with color:', color);
    
    // Draw the box
    try {
      ctx.strokeRect(x, y, width, height);
      console.log('Debug: Successfully drew box at coordinates:', { x, y, width, height });
    } catch (error) {
      console.error('Error drawing box:', error);
    }
    
    // Draw the index number and confidence with background
    const padding = 4;
    const label = box.mesh_id || displayIndex.toString();
    const confidenceText = box.confidence !== undefined ? ` (${(box.confidence * 100).toFixed(1)}%)` : '';
    const actionText = box.action ? `\n${box.action}` : '';
    const fullText = `${label}${confidenceText}${actionText}`;
    const lines = fullText.split('\n');
    const lineHeight = 14;
    const textHeight = lineHeight * lines.length;
    const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    
    try {
      // Draw background for text
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - padding, y - textHeight - padding, maxWidth + (padding * 2), textHeight + (padding * 2));
      
      // Draw text lines
      ctx.fillStyle = 'white';
      lines.forEach((line, i) => {
        ctx.fillText(line, x, y - padding - (textHeight - lineHeight * (i + 1)));
      });
      console.log('Debug: Successfully drew label');
    } catch (error) {
      console.error('Error drawing label:', error);
    }
  });
  
  // Save the visualization with boxes
  const debugImagePath = path.join(sessionDir, 'visualization.png');
  fs.writeFileSync(debugImagePath, canvas.toBuffer('image/png'));
  
  // Save window info
  const windowInfoPath = path.join(sessionDir, 'window_info.json');
  fs.writeFileSync(windowInfoPath, JSON.stringify(windowInfo, null, 2));
  
  console.log('Debug: Saved all segments and metadata to:', sessionDir);
  
  // Return both the visualization and original data
  return {
    debugImage: canvas.toBuffer('image/png'),
    originalImage: imageBuffer,
    boxes: boxes,
    windowInfo: windowInfo,
    debugDir: sessionDir
  };
}

// Add IPC handler for getting intelligent mode state
ipcMain.handle('get-intelligent-mode', () => {
  return isIntelligentMode;
});

// Add IPC handler for setting intelligent mode state
ipcMain.handle('set-intelligent-mode', async (event, newMode) => {
  isIntelligentMode = newMode;
  // Notify all windows of the mode change
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('intelligent-mode-changed', newMode);
  });
  return isIntelligentMode;
});

// Initialize app when ready
app.whenReady().then(async () => {
  try {
    // Start Python service first
    await startPythonService();
    
    createWindow();
    createTray();

    // Start window refresh after initial permission check
    mainWindow.webContents.once('did-finish-load', async () => {
      const hasPermission = await checkScreenRecordingPermission(true);
      if (hasPermission) {
        startWindowRefresh();
      }
    });
  } catch (error) {
    console.error('Failed to initialize app:', error);
    dialog.showErrorBox('Initialization Error', 
      'Failed to start the application. Please check your configuration and try again.');
    app.quit();
  }
});