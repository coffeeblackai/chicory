const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const API_ENDPOINT = process.env.API_ENDPOINT || 'https://app.coffeeblack.ai/api/reason';

async function analyzeElements(elements, query, imageBuffer = null) {
  try {
    // Create debug directory
    const debugDir = path.join(process.cwd(), 'debug', new Date().toISOString().replace(/[:.]/g, '-'));
    await fs.promises.mkdir(debugDir, { recursive: true });

    // Save debug info
    await fs.promises.writeFile(
      path.join(debugDir, 'request.json'),
      JSON.stringify({ query, elements }, null, 2)
    );

    // Prepare form data
    const formData = new FormData();
    formData.append('query', query);
    
    if (imageBuffer) {
      formData.append('file', imageBuffer, 'screenshot.png');
    }

    // Call API
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const result = await response.json();

    // Save API response for debugging
    await fs.promises.writeFile(
      path.join(debugDir, 'api_response.json'),
      JSON.stringify(result, null, 2)
    );

    // Transform API response to match expected format
    return {
      element_index: result.chosen_element_index,
      confidence: result.confidence || 0,
      context: result.explanation || '',
      actions: (result.actions || []).map(action => ({
        action: action.action,
        key_command: action.key_command || null,
        input_text: action.input_text || null,
        scroll_direction: action.scroll_direction || null,
        element_index: result.chosen_element_index,
        confidence: result.confidence || 0
      }))
    };
  } catch (error) {
    console.error('Error analyzing elements:', error);
    throw error;
  }
}

module.exports = {
  analyzeElements
}; 