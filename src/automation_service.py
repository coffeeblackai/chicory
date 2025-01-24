from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pyautogui
import uvicorn
from typing import Optional, List, Dict, Any
import time
import logging
import subprocess
import sys
import os
import asyncio
from datetime import datetime
import json
from google.cloud import aiplatform
from vertexai.preview.generative_models import GenerativeModel, Part
import base64

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure PyAutoGUI
pyautogui.FAILSAFE = True  # Move mouse to corner to abort
pyautogui.PAUSE = 0.1  # Add small delay between actions

app = FastAPI()

class Point(BaseModel):
    x: int
    y: int

class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int

class WindowInfo(BaseModel):
    bounds: Optional[Dict[str, int]] = None
    owner: Optional[Dict[str, Any]] = None

class ClickRequest(BaseModel):
    x: int
    y: int
    window_info: Optional[WindowInfo] = None

class TypeRequest(BaseModel):
    text: str
    window_info: Optional[WindowInfo] = None

class KeyRequest(BaseModel):
    key: str
    window_info: Optional[WindowInfo] = None

class ScrollRequest(BaseModel):
    x: int
    y: int
    direction: str  # "up", "down", "left", "right"
    window_info: Optional[WindowInfo] = None
    element_info: Optional[Dict[str, Any]] = None

class Action(BaseModel):
    action: str
    element_index: Optional[int] = None
    input_text: Optional[str] = None
    key_command: Optional[str] = None
    bbox: Optional[BoundingBox] = None
    window_info: Optional[WindowInfo] = None

class ScrollAndCaptureRequest(BaseModel):
    x: int
    y: int
    window_info: Optional[WindowInfo] = None
    goal: Optional[str] = None  # Made optional
    element_info: Optional[Dict[str, Any]] = None

def focus_window_macos(process_id: int) -> bool:
    """Focus a window on macOS using AppleScript"""
    try:
        script = f'''
        tell application "System Events"
            set frontmost of the first process whose unix id is {process_id} to true
        end tell
        '''
        subprocess.run(['osascript', '-e', script], check=True)
        # Small delay to ensure window is focused
        time.sleep(0.2)
        return True
    except Exception as e:
        logger.error(f"Error focusing window: {e}")
        return False

async def ensure_window_focused(window_info: Optional[WindowInfo]) -> bool:
    """Ensure the target window is focused before performing actions"""
    if not window_info or not window_info.owner:
        return False
        
    if sys.platform == 'darwin':
        process_id = window_info.owner.get('processId')
        if process_id:
            return focus_window_macos(process_id)
    
    return False

@app.post("/mouse/move")
async def move_mouse(request: ClickRequest):
    try:
        if request.window_info:
            await ensure_window_focused(request.window_info)
        pyautogui.moveTo(request.x, request.y, duration=0.2)  # Smooth movement
        return {"success": True}
    except Exception as e:
        logger.error(f"Error moving mouse: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/mouse/click")
async def click_mouse(request: ClickRequest):
    try:
        logger.info(f"Click request at ({request.x}, {request.y})")
        if request.window_info:
            await ensure_window_focused(request.window_info)
        # First move to position
        pyautogui.moveTo(request.x, request.y, duration=0.2)
        # Then click
        pyautogui.click()
        return {"success": True}
    except Exception as e:
        logger.error(f"Error clicking: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/mouse/right_click")
async def right_click_mouse(request: ClickRequest):
    try:
        logger.info(f"Right click request at ({request.x}, {request.y})")
        if request.window_info:
            await ensure_window_focused(request.window_info)
        # First move to position
        pyautogui.moveTo(request.x, request.y, duration=0.2)
        # Then right click
        pyautogui.rightClick()
        return {"success": True}
    except Exception as e:
        logger.error(f"Error right clicking: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/keyboard/type")
async def type_text(request: TypeRequest):
    try:
        if request.window_info:
            await ensure_window_focused(request.window_info)
        pyautogui.typewrite(request.text)
        return {"success": True}
    except Exception as e:
        logger.error(f"Error typing: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/keyboard/key")
async def press_key(request: KeyRequest):
    try:
        if request.window_info:
            await ensure_window_focused(request.window_info)
        key = request.key.lower()
        if key in ["enter", "tab", "escape"]:
            pyautogui.press(key)
        return {"success": True}
    except Exception as e:
        logger.error(f"Error pressing key: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/mouse/scroll")
async def scroll_mouse(request: ScrollRequest):
    try:
        logger.info(f"Scroll request at ({request.x}, {request.y}) direction: {request.direction}")
        if request.window_info:
            await ensure_window_focused(request.window_info)
        
        # Move to position first
        pyautogui.moveTo(request.x, request.y, duration=0.2)
        
        # Convert direction to scroll amount
        # Positive numbers scroll up, negative numbers scroll down
        # We use smaller scroll amounts to match scroll_and_capture behavior
        scroll_amount = {
            "up": 25,
            "down": -25,
            "left": -15,
            "right": 15
        }.get(request.direction.lower(), -25)  # Default to scroll down
        
        # Perform scroll in smaller chunks for smoothness
        remaining_scroll = abs(scroll_amount)
        scroll_direction = 1 if scroll_amount > 0 else -1
        
        while remaining_scroll > 0:
            # Scroll in tiny chunks of 15 pixels or less
            scroll_chunk = min(15, remaining_scroll)
            if request.direction.lower() in ["up", "down"]:
                pyautogui.scroll(scroll_chunk * scroll_direction)
            else:
                pyautogui.hscroll(scroll_chunk * scroll_direction)
            remaining_scroll -= scroll_chunk
            time.sleep(0.3)  # Small delay between chunks
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Error scrolling: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/execute")
async def execute_action(action: Action):
    try:
        if action.window_info:
            await ensure_window_focused(action.window_info)
            
        if action.action.lower() == "click" and action.bbox:
            # Calculate center of bounding box
            center_x = action.bbox.x + (action.bbox.width // 2)
            center_y = action.bbox.y + (action.bbox.height // 2)
            
            logger.info(f"Executing click at ({center_x}, {center_y})")
            # Move and click
            pyautogui.moveTo(center_x, center_y, duration=0.2)
            pyautogui.click()
            
        elif action.action.lower() == "type":
            if action.input_text:
                pyautogui.typewrite(action.input_text)
                
            if action.key_command:
                key = action.key_command.lower()
                if key in ["enter", "tab", "escape"]:
                    pyautogui.press(key)
                    
        elif action.action.lower() == "keyboard":
            if action.key_command:
                key = action.key_command.lower()
                if key in ["enter", "tab", "escape"]:
                    pyautogui.press(key)
                    
        return {"success": True}
    except Exception as e:
        logger.error(f"Error executing action: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "ok"}

async def analyze_initial_screenshot(image_path: str, goal: str) -> dict:
    """First stage: Analyze initial screenshot to determine content type and create extraction schema"""
    try:
        # Initialize Vertex AI
        aiplatform.init(project=os.getenv('GOOGLE_CLOUD_PROJECT'))
        model = GenerativeModel('gemini-1.5-flash-001')
        
        # Read the image
        with open(image_path, 'rb') as img_file:
            image_bytes = img_file.read()
        
        # Create image part
        image_part = Part.from_data(data=base64.b64encode(image_bytes).decode(), mime_type="image/png")
        
        # Initial analysis prompt
        prompt = f"""
        Goal: {goal}
        
        Analyze this screenshot and create a detailed extraction plan. Steps:
        1. Identify the type of content visible (e.g., social media posts, articles, product listings)
        2. List the key elements and data points that should be extracted
        3. Create a structured schema for extracting this information consistently
        
        Return a JSON object with:
        {{
            "content_type": "identified content type",
            "key_elements": ["list of important elements to extract"],
            "extraction_schema": {{
                // Define the exact structure for extracted data
            }},
            "extraction_prompt": "Detailed prompt for analyzing subsequent screenshots",
            "initial_analysis": {{
                // Analysis of this first screenshot using the schema
            }}
        }}
        
        Make the extraction_prompt specific and detailed, as it will be used to analyze all screenshots.
        Include instructions for handling partial content that may span multiple screenshots.
        """
        
        # Generate response
        response = model.generate_content([prompt, image_part])
        
        # Parse and clean the response
        try:
            result = json.loads(response.text)
        except json.JSONDecodeError:
            text = response.text.strip()
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(text[start:end])
            else:
                raise ValueError("Could not parse Gemini response as JSON")
                
        return result
        
    except Exception as e:
        logger.error(f"Error in initial screenshot analysis: {e}")
        return {
            "error": str(e),
            "content_type": "unknown",
            "key_elements": [],
            "extraction_schema": {"content": []},
            "extraction_prompt": "Extract visible text content",
            "initial_analysis": {}
        }

async def analyze_screenshot_with_schema(image_path: str, extraction_context: dict) -> dict:
    """Second stage: Analyze screenshot using the established schema"""
    try:
        # Initialize Vertex AI
        aiplatform.init(project=os.getenv('GOOGLE_CLOUD_PROJECT'))
        model = GenerativeModel('gemini-1.5-flash-001')
        
        # Read the image
        with open(image_path, 'rb') as img_file:
            image_bytes = img_file.read()
        
        # Create image part
        image_part = Part.from_data(data=base64.b64encode(image_bytes).decode(), mime_type="image/png")
        
        # Use the extraction prompt from initial analysis
        prompt = f"""
        {extraction_context['extraction_prompt']}
        
        Content Type: {extraction_context['content_type']}
        
        Extract information according to this schema:
        {json.dumps(extraction_context['extraction_schema'], indent=2)}
        
        Key elements to identify:
        {json.dumps(extraction_context['key_elements'], indent=2)}
        
        Guidelines:
        1. Maintain consistency with the schema
        2. Note any content that might continue in next screenshot
        3. Preserve exact text and numbers
        4. Include all relevant metadata
        """
        
        # Generate response
        response = model.generate_content([prompt, image_part])
        
        # Parse and clean the response
        try:
            result = json.loads(response.text)
        except json.JSONDecodeError:
            text = response.text.strip()
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(text[start:end])
            else:
                raise ValueError("Could not parse Gemini response as JSON")
                
        return result
        
    except Exception as e:
        logger.error(f"Error analyzing screenshot with schema: {e}")
        return {
            "error": str(e),
            "content": []
        }

async def infer_goal_from_context(window_info: Optional[WindowInfo], element_info: Optional[Dict[str, Any]]) -> str:
    """Infer the analysis goal from window and element context"""
    if not window_info:
        return "Extract visible content"
        
    # Get window title
    title = window_info.title if hasattr(window_info, 'title') else None
    
    # Infer goal based on window title
    if title:
        if "LinkedIn" in title:
            return "Extract LinkedIn posts and content"
        elif "Twitter" in title or "X.com" in title:
            return "Extract Twitter/X posts and threads"
        elif "GitHub" in title:
            return "Extract GitHub content and discussions"
        elif "Reddit" in title:
            return "Extract Reddit posts and comments"
        elif "Medium" in title:
            return "Extract Medium article content"
            
    return "Extract visible content and structure"

async def merge_and_deduplicate_analyses(capture_dir: str, extraction_context: dict) -> dict:
    """Final stage: Merge and deduplicate all analysis JSONs using Gemini"""
    try:
        # Initialize Vertex AI
        aiplatform.init(project=os.getenv('GOOGLE_CLOUD_PROJECT'))
        model = GenerativeModel('gemini-1.5-flash-001')
        
        # Collect all analysis JSONs
        analyses = []
        for filename in sorted(os.listdir(capture_dir)):
            if filename.endswith('_analysis.json'):
                with open(os.path.join(capture_dir, filename), 'r') as f:
                    analyses.append(json.load(f))
        
        # Create merge prompt
        prompt = f"""
        Merge and deduplicate content from multiple screenshot analyses.
        
        Content Type: {extraction_context['content_type']}
        Schema: {json.dumps(extraction_context['extraction_schema'], indent=2)}
        
        Input analyses from {len(analyses)} screenshots:
        {json.dumps(analyses, indent=2)}
        
        Tasks:
        1. Merge all content following the original schema
        2. Remove duplicate entries
        3. Handle content that spans multiple screenshots
        4. Preserve all unique metadata and metrics
        5. Maintain chronological order of content
        
        Return a single JSON object containing all unique content and metadata.
        """
        
        # Generate response
        response = model.generate_content(prompt)
        
        # Parse and clean the response
        try:
            result = json.loads(response.text)
        except json.JSONDecodeError:
            text = response.text.strip()
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(text[start:end])
            else:
                raise ValueError("Could not parse Gemini response as JSON")
        
        # Save merged result
        with open(os.path.join(capture_dir, "merged_analysis.json"), 'w') as f:
            json.dump(result, f, indent=2)
            
        return result
        
    except Exception as e:
        logger.error(f"Error merging analyses: {e}")
        return {
            "error": str(e),
            "content": []
        }

@app.post("/mouse/scroll_and_capture")
async def scroll_and_capture(request: ScrollAndCaptureRequest):
    try:
        # Infer goal if not provided
        if not request.goal:
            request.goal = await infer_goal_from_context(request.window_info, request.element_info)
            
        logger.info(f"Scroll and capture request at ({request.x}, {request.y}) with goal: {request.goal}")
        
        if request.window_info:
            await ensure_window_focused(request.window_info)
            
        # Move to position first
        pyautogui.moveTo(request.x, request.y, duration=0.2)
        
        # Create timestamp for this capture session
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        capture_dir = os.path.join("captures", timestamp)
        os.makedirs(capture_dir, exist_ok=True)
        
        # Get the window bounds
        if not request.window_info or not request.window_info.bounds:
            raise HTTPException(status_code=400, detail="Window bounds not provided")
            
        bounds = request.window_info.bounds
        viewport_width = bounds.get('width', 0)
        viewport_height = bounds.get('height', 0)
        window_x = bounds.get('x', 0)
        window_y = bounds.get('y', 0)
        
        if viewport_width == 0 or viewport_height == 0:
            raise HTTPException(status_code=400, detail="Invalid window dimensions")
        
        # Calculate scroll amount - use much smaller fixed amounts
        base_scroll_amount = 25  # Scroll 75 pixels at a time
        overlap_pixels = 40  # Keep 40 pixels of overlap
        scroll_amount = base_scroll_amount - overlap_pixels  # Net 35 pixels per scroll
        logger.info(f"Viewport height: {viewport_height}, Base scroll: {base_scroll_amount}, Overlap: {overlap_pixels}, Net scroll: {scroll_amount}")
        
        # Take initial screenshot
        screenshot = pyautogui.screenshot(region=(window_x, window_y, viewport_width, viewport_height))
        screenshot_path = os.path.join(capture_dir, f"viewport_0.png")
        screenshot.save(screenshot_path)
        
        # First stage: Analyze initial screenshot and create extraction schema
        extraction_context = await analyze_initial_screenshot(screenshot_path, request.goal)
        with open(os.path.join(capture_dir, "extraction_context.json"), 'w') as f:
            json.dump(extraction_context, f, indent=2)
        
        # Save viewport info
        viewport_info = {
            "viewport_height": viewport_height,
            "base_scroll_amount": base_scroll_amount,
            "overlap_pixels": overlap_pixels,
            "net_scroll_amount": scroll_amount,
            "total_scrolled": 0
        }
        with open(os.path.join(capture_dir, "viewport_info.json"), 'w') as f:
            json.dump(viewport_info, f, indent=2)
        
        # Save initial analysis
        with open(os.path.join(capture_dir, f"viewport_0_analysis.json"), 'w') as f:
            json.dump(extraction_context["initial_analysis"], f, indent=2)
        
        # Scroll and capture multiple viewports
        max_viewports = 5
        scroll_delay = 1.0
        total_scrolled = 0
        
        for i in range(1, max_viewports):
            # Scroll in very small increments for smoothness
            remaining_scroll = scroll_amount
            while remaining_scroll > 0:
                # Scroll in tiny chunks of 15 pixels or less
                scroll_chunk = min(15, remaining_scroll)
                pyautogui.scroll(-scroll_chunk)
                remaining_scroll -= scroll_chunk
                await asyncio.sleep(0.3)
            
            total_scrolled += scroll_amount
            viewport_info["total_scrolled"] = total_scrolled
            
            # Update viewport info file
            with open(os.path.join(capture_dir, "viewport_info.json"), 'w') as f:
                json.dump(viewport_info, f, indent=2)
            
            # Wait longer for content to load and settle
            await asyncio.sleep(scroll_delay)
            
            screenshot = pyautogui.screenshot(region=(window_x, window_y, viewport_width, viewport_height))
            screenshot_path = os.path.join(capture_dir, f"viewport_{i}.png")
            screenshot.save(screenshot_path)
            
            # Second stage: Analyze screenshot using established schema
            analysis = await analyze_screenshot_with_schema(screenshot_path, extraction_context)
            with open(os.path.join(capture_dir, f"viewport_{i}_analysis.json"), 'w') as f:
                json.dump(analysis, f, indent=2)
        
        # After all screenshots are captured and analyzed
        logger.info("Merging and deduplicating analyses...")
        merged_analysis = await merge_and_deduplicate_analyses(capture_dir, extraction_context)
        
        return {
            "success": True,
            "capture_dir": capture_dir,
            "viewport_count": max_viewports,
            "extraction_context": extraction_context,
            "viewport_info": viewport_info,
            "merged_analysis": merged_analysis
        }
    except Exception as e:
        logger.error(f"Error in scroll and capture: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    logger.info("Starting automation service on http://127.0.0.1:8123")
    logger.info("PyAutoGUI configured with FAILSAFE=True and PAUSE=0.1s")
    uvicorn.run(app, host="127.0.0.1", port=8123, log_level="info") 