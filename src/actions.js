const { clipboard } = require('electron');
const fetch = require('node-fetch');
const { screen } = require('electron');

const AUTOMATION_SERVICE_URL = 'http://127.0.0.1:8123';
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second

/**
 * Check if automation service is running
 * @returns {Promise<boolean>}
 */
async function checkServiceHealth(retries = 0) {
  try {
    const response = await fetch(`${AUTOMATION_SERVICE_URL}/health`);
    return response.ok;
  } catch (error) {
    if (retries < MAX_RETRIES) {
      console.log(`Automation service not ready, retrying in ${RETRY_DELAY}ms... (${retries + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return checkServiceHealth(retries + 1);
    }
    console.error('Failed to connect to automation service:', error);
    return false;
  }
}

/**
 * Execute a sequence of UI actions
 * @param {Array} actions - Array of actions from Gemini
 * @param {Array} elements - Original array of UI elements
 * @param {Object} windowInfo - Information about the target window
 */
async function executeActions(actions, elements, windowInfo) {
  // Check if service is running first
  const isServiceRunning = await checkServiceHealth();
  if (!isServiceRunning) {
    throw new Error('Automation service is not running. Please start the Python service first.');
  }

  for (const action of actions) {
    try {
      console.log('Executing action:', action);

      // Find target element if specified
      let targetElement = null;
      if (action.element_index !== null || action.mesh_id !== null) {
        targetElement = elements.find(e => 
          action.mesh_id ? e.mesh_id === action.mesh_id : e.originalIndex === action.element_index
        );
        action.targetElement = targetElement;
      }

      // Get display info
      const displays = screen.getAllDisplays();
      const display = displays.find(d => {
        const bounds = d.bounds;
        return windowInfo.bounds.x >= bounds.x && 
               windowInfo.bounds.x < bounds.x + bounds.width &&
               windowInfo.bounds.y >= bounds.y && 
               windowInfo.bounds.y < bounds.y + bounds.height;
      }) || screen.getPrimaryDisplay();

      console.log('Display info:', {
        id: displays.indexOf(display),
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        windowCenter: {
          x: windowInfo.bounds.x + (windowInfo.bounds.width / 2),
          y: windowInfo.bounds.y + (windowInfo.bounds.height / 2)
        }
      });

      console.log('Window info:', {
        windowX: windowInfo.bounds.x,
        windowY: windowInfo.bounds.y,
        scaleFactor: windowInfo.scaleFactor
      });

      if (action.action === 'scroll' || action.action === 'scroll_and_capture') {
        // Always scroll in the center of the window
        const windowCenter = {
          x: Math.round(windowInfo.bounds.x + (windowInfo.bounds.width / 2)),
          y: Math.round(windowInfo.bounds.y + (windowInfo.bounds.height / 2))
        };

        console.log('Scroll action at window center:', windowCenter);

        if (action.action === 'scroll_and_capture') {
          const response = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/scroll_and_capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: windowCenter.x,
              y: windowCenter.y,
              goal: 'Extract visible content and structure',
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title
              }
            })
          });

          if (!response.ok) {
            throw new Error(`Scroll and capture failed: ${response.statusText}`);
          }

          const result = await response.json();
          console.log('Scroll and capture completed:', result);
        } else {
          const response = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/scroll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: windowCenter.x,
              y: windowCenter.y,
              direction: action.scroll_direction || 'down',
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title
              }
            })
          });

          if (!response.ok) {
            throw new Error(`Scroll failed: ${response.statusText}`);
          }
        }
        continue;
      }

      // For non-scroll actions, use the target element position
      if (!targetElement || !targetElement.bbox) {
        console.error('No valid target element or bbox for action:', action);
        continue;
      }

      // Enhanced action and element logging
      console.log('\nExecuting action:', {
        ...action,
        targetElement: {
          index: action.element_index,  // This is now guaranteed to be 0-based
          mesh_id: targetElement.mesh_id,
          type: targetElement.type,
          role: targetElement.metadata?.role,
          text: targetElement.text || targetElement.metadata?.text_content || '',
          bbox: {
            window: targetElement.bbox?.window,
            screen: targetElement.bbox?.screen
          },
          description: targetElement.metadata?.gemini_analysis?.description || '',
          possibleActions: targetElement.metadata?.gemini_analysis?.possible_actions || []
        }
      });
      
      switch (action.action.toLowerCase()) {
        case 'click': {
          if (!targetElement.bbox?.window) {
            throw new Error('No window bounding box found for element');
          }
          
          // Calculate screen coordinates relative to the display
          const bbox = targetElement.bbox.window;
          
          // First scale the coordinates
          const scaledX = bbox.x / windowInfo.scaleFactor;
          const scaledY = bbox.y / windowInfo.scaleFactor;
          const scaledWidth = bbox.width / windowInfo.scaleFactor;
          const scaledHeight = bbox.height / windowInfo.scaleFactor;
          
          // Then add window position to get global screen coordinates
          const centerX = Math.round(windowInfo.bounds.x + scaledX + (scaledWidth / 2));
          const centerY = Math.round(windowInfo.bounds.y + scaledY + (scaledHeight / 2));
          
          console.log('Clicking at:', { 
            centerX, 
            centerY,
            display: {
              bounds: display.bounds,
              workArea: display.workArea
            },
            windowPos: { x: windowInfo.bounds.x, y: windowInfo.bounds.y }, 
            bbox,
            scaledCoords: {
              x: scaledX,
              y: scaledY,
              width: scaledWidth,
              height: scaledHeight
            }
          });
          
          // Send click request to Python service with more info
          const response = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: centerX,
              y: centerY,
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title
              },
              element_info: {
                bbox: targetElement.bbox,
                type: targetElement.type,
                role: targetElement.metadata?.role
              }
            })
          });
          
          if (!response.ok) {
            const error = await response.json().catch(() => response.text());
            throw new Error(`Failed to click: ${JSON.stringify(error)}`);
          }
          
          // Add small delay after click
          await new Promise(resolve => setTimeout(resolve, 100));
          break;
        }

        case 'right_click': {
          if (!targetElement.bbox?.window) {
            throw new Error('No window bounding box found for element');
          }
          
          // Calculate screen coordinates relative to the display
          const bbox = targetElement.bbox.window;
          
          // First scale the coordinates
          const scaledX = bbox.x / windowInfo.scaleFactor;
          const scaledY = bbox.y / windowInfo.scaleFactor;
          const scaledWidth = bbox.width / windowInfo.scaleFactor;
          const scaledHeight = bbox.height / windowInfo.scaleFactor;
          
          // Then add window position to get global screen coordinates
          const centerX = Math.round(windowInfo.bounds.x + scaledX + (scaledWidth / 2));
          const centerY = Math.round(windowInfo.bounds.y + scaledY + (scaledHeight / 2));
          
          console.log('Right clicking at:', { 
            centerX, 
            centerY,
            display: {
              bounds: display.bounds,
              workArea: display.workArea
            },
            windowPos: { x: windowInfo.bounds.x, y: windowInfo.bounds.y }, 
            bbox,
            scaledCoords: {
              x: scaledX,
              y: scaledY,
              width: scaledWidth,
              height: scaledHeight
            }
          });
          
          // Send right click request to Python service
          const response = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/right_click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: centerX,
              y: centerY,
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title
              },
              element_info: {
                bbox: targetElement.bbox,
                type: targetElement.type,
                role: targetElement.metadata?.role
              }
            })
          });
          
          if (!response.ok) {
            const error = await response.json().catch(() => response.text());
            throw new Error(`Failed to right click: ${JSON.stringify(error)}`);
          }
          
          // Add small delay after click
          await new Promise(resolve => setTimeout(resolve, 100));
          break;
        }
        
        case 'type': {
          if (!targetElement.bbox?.window) {
            throw new Error('No window bounding box found for element');
          }
          
          // Calculate screen coordinates relative to the display
          const bbox = targetElement.bbox.window;
          
          // First scale the coordinates
          const scaledX = bbox.x / windowInfo.scaleFactor;
          const scaledY = bbox.y / windowInfo.scaleFactor;
          const scaledWidth = bbox.width / windowInfo.scaleFactor;
          const scaledHeight = bbox.height / windowInfo.scaleFactor;
          
          // Then add window position to get global screen coordinates
          const centerX = Math.round(windowInfo.bounds.x + scaledX + (scaledWidth / 2));
          const centerY = Math.round(windowInfo.bounds.y + scaledY + (scaledHeight / 2));
          
          console.log('Clicking before type at:', { 
            centerX, 
            centerY,
            display: {
              bounds: display.bounds,
              workArea: display.workArea
            },
            windowPos: { x: windowInfo.bounds.x, y: windowInfo.bounds.y }, 
            bbox,
            scaledCoords: {
              x: scaledX,
              y: scaledY,
              width: scaledWidth,
              height: scaledHeight
            }
          });
          
          // Send click request to Python service
          const clickResponse = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: centerX,
              y: centerY,
              window_info: {
                owner: windowInfo.owner
              }
            })
          });
          
          if (!clickResponse.ok) {
            const error = await clickResponse.text();
            throw new Error(`Failed to click before typing: ${error}`);
          }
          
          // Small delay after click
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Type the text
          if (action.input_text) {
            const typeResponse = await fetch(`${AUTOMATION_SERVICE_URL}/keyboard/type`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: action.input_text,
                window_info: {
                  owner: windowInfo.owner
                }
              })
            });
            
            if (!typeResponse.ok) {
              const error = await typeResponse.text();
              throw new Error(`Failed to type text: ${error}`);
            }
          }
          
          // Handle any additional key commands
          if (action.key_command) {
            const keyResponse = await fetch(`${AUTOMATION_SERVICE_URL}/keyboard/key`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: action.key_command.toLowerCase(),
                window_info: {
                  owner: windowInfo.owner
                }
              })
            });
            
            if (!keyResponse.ok) {
              const error = await keyResponse.text();
              throw new Error(`Failed to press key: ${error}`);
            }
          }
          break;
        }
        
        case 'keyboard': {
          if (action.key_command) {
            const keyResponse = await fetch(`${AUTOMATION_SERVICE_URL}/keyboard/key`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: action.key_command.toLowerCase(),
                window_info: {
                  owner: windowInfo.owner
                }
              })
            });
            
            if (!keyResponse.ok) {
              const error = await keyResponse.text();
              throw new Error(`Failed to press key: ${error}`);
            }
          }
          break;
        }

        case 'scroll': {
          // Calculate window center coordinates
          const windowCenterX = Math.round(windowInfo.bounds.x + (windowInfo.bounds.width / 2));
          const windowCenterY = Math.round(windowInfo.bounds.y + (windowInfo.bounds.height / 2));

          // Get scroll direction from action
          const direction = action.scroll_direction?.toLowerCase() || 'down';
          
          console.log('Scrolling at window center:', { 
            windowCenterX, 
            windowCenterY,
            direction,
            display: {
              bounds: display.bounds,
              workArea: display.workArea
            },
            windowPos: { x: windowInfo.bounds.x, y: windowInfo.bounds.y },
            windowSize: { width: windowInfo.bounds.width, height: windowInfo.bounds.height }
          });

          // Send scroll request at window center
          const scrollResponse = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/scroll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: windowCenterX,
              y: windowCenterY,
              direction: direction,
              simulate_wheel: true,
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title,
                focus: true // Request window focus before scrolling
              }
            })
          });

          if (!scrollResponse.ok) {
            const error = await scrollResponse.json().catch(() => scrollResponse.text());
            throw new Error(`Failed to scroll: ${JSON.stringify(error)}`);
          }

          break;
        }

        case 'scroll_and_capture': {
          // Calculate window center coordinates
          const windowCenterX = Math.round(windowInfo.bounds.x + (windowInfo.bounds.width / 2));
          const windowCenterY = Math.round(windowInfo.bounds.y + (windowInfo.bounds.height / 2));
          
          console.log('Scroll and capture at window center:', { 
            windowCenterX, 
            windowCenterY,
            display: {
              bounds: display.bounds,
              workArea: display.workArea
            },
            windowPos: { x: windowInfo.bounds.x, y: windowInfo.bounds.y },
            windowSize: { width: windowInfo.bounds.width, height: windowInfo.bounds.height }
          });

          // Send scroll and capture request at window center
          const response = await fetch(`${AUTOMATION_SERVICE_URL}/mouse/scroll_and_capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: windowCenterX,
              y: windowCenterY,
              simulate_wheel: true,
              window_info: {
                owner: windowInfo.owner,
                bounds: windowInfo.bounds,
                title: windowInfo.title,
                focus: true // Request window focus before scrolling
              }
            })
          });

          if (!response.ok) {
            const error = await response.json().catch(() => response.text());
            throw new Error(`Failed to scroll and capture: ${JSON.stringify(error)}`);
          }

          const result = await response.json();
          console.log('Scroll and capture completed:', result);
          break;
        }
      }
      
      // Small delay between actions
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('Error executing action:', action, error);
      throw error;
    }
  }
}

module.exports = {
  executeActions
}; 