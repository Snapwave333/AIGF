// Ollama LLM Client for Raven AI Assistant
import fetch from 'node-fetch';

export class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3:8b') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          ...options.modelOptions
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      message: data.message,
      done: data.done,
      totalDuration: data.total_duration,
      loadDuration: data.load_duration,
      evalCount: data.eval_count
    };
  }

  async generate(prompt, systemPrompt = '', options = {}) {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          top_p: options.top_p || 0.9,
          ...options.modelOptions
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      response: data.response,
      done: data.done,
      context: data.context
    };
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json();
    return data.models || [];
  }

  async pullModel(modelName) {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    });
    return response.ok;
  }

  async isHealthy() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Function calling support - parse Ollama response for tool calls
  parseToolCalls(response) {
    // Look for JSON-like tool call patterns in the response
    const toolCallPattern = /```json\s*(\{[\s\S]*?"tool":\s*"[^"]+[\s\S]*?\})\s*```/g;
    const calls = [];
    let match;

    while ((match = toolCallPattern.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.tool) {
          calls.push(parsed);
        }
      } catch {
        // Skip malformed JSON
      }
    }

    return calls;
  }
}

export default OllamaClient;
