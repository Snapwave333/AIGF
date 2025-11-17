// Piper TTS Integration for Raven AI Assistant
// Local text-to-speech using Piper with virtual audio cable support

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export class PiperTTS {
  constructor(config = {}) {
    this.modelPath = config.modelPath || './models/en_US-lessac-medium.onnx';
    this.configPath = config.configPath || `${this.modelPath}.json`;
    this.piperPath = config.piperPath || 'piper'; // Assumes piper is in PATH
    this.outputDir = config.outputDir || './temp/audio';
    this.virtualAudioDevice = config.virtualAudioDevice || 'CABLE Input';

    // Voice settings for Raven (lower pitch, slower rate for deadpan delivery)
    this.voiceSettings = {
      lengthScale: config.lengthScale || 1.1, // Slightly slower
      noiseScale: config.noiseScale || 0.667,
      noiseW: config.noiseW || 0.8,
      ...config.voiceSettings
    };

    this.initialized = false;
  }

  async initialize() {
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Check if Piper is available
    const piperAvailable = await this.checkPiperInstalled();

    if (!piperAvailable) {
      console.warn('Piper TTS not found in PATH. Local TTS will not be available.');
      console.warn('Install Piper from: https://github.com/rhasspy/piper');
    }

    // Check if model exists
    if (!fs.existsSync(this.modelPath)) {
      console.warn(`Piper model not found: ${this.modelPath}`);
      console.warn('Download voices from: https://github.com/rhasspy/piper/releases');
    }

    this.initialized = piperAvailable && fs.existsSync(this.modelPath);
    return this.initialized;
  }

  async checkPiperInstalled() {
    return new Promise((resolve) => {
      const proc = spawn(this.piperPath, ['--version']);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));

      // Timeout after 2 seconds
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 2000);
    });
  }

  // Generate speech from text
  async synthesize(text, options = {}) {
    if (!this.initialized) {
      throw new Error('Piper TTS not initialized. Check installation and model path.');
    }

    const outputFile = options.outputFile ||
      path.join(this.outputDir, `raven_${Date.now()}.wav`);

    return new Promise((resolve, reject) => {
      const args = [
        '--model', this.modelPath,
        '--output_file', outputFile,
        '--length_scale', String(this.voiceSettings.lengthScale),
        '--noise_scale', String(this.voiceSettings.noiseScale),
        '--noise_w', String(this.voiceSettings.noiseW)
      ];

      if (options.jsonInput) {
        args.push('--json-input');
      }

      const piper = spawn(this.piperPath, args);

      let stderr = '';

      piper.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      piper.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}: ${stderr}`));
          return;
        }

        if (!fs.existsSync(outputFile)) {
          reject(new Error('Piper did not create output file'));
          return;
        }

        resolve({
          path: outputFile,
          size: fs.statSync(outputFile).size,
          text,
          timestamp: Date.now()
        });
      });

      piper.on('error', (err) => {
        reject(new Error(`Piper spawn error: ${err.message}`));
      });

      // Send text to Piper's stdin
      piper.stdin.write(text);
      piper.stdin.end();
    });
  }

  // Generate speech and return as buffer
  async synthesizeToBuffer(text, options = {}) {
    const result = await this.synthesize(text, options);

    const buffer = fs.readFileSync(result.path);

    // Clean up temp file unless specified
    if (!options.keepFile) {
      fs.unlinkSync(result.path);
    }

    return {
      buffer,
      format: 'wav',
      sampleRate: 22050, // Default Piper sample rate
      text,
      timestamp: result.timestamp
    };
  }

  // Stream synthesis for real-time output
  async synthesizeStream(text) {
    if (!this.initialized) {
      throw new Error('Piper TTS not initialized');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '--model', this.modelPath,
        '--output-raw',
        '--length_scale', String(this.voiceSettings.lengthScale),
        '--noise_scale', String(this.voiceSettings.noiseScale),
        '--noise_w', String(this.voiceSettings.noiseW)
      ];

      const piper = spawn(this.piperPath, args);

      // Create a readable stream from Piper's output
      const audioStream = piper.stdout;

      piper.on('error', (err) => {
        reject(new Error(`Piper stream error: ${err.message}`));
      });

      // Send text to Piper
      piper.stdin.write(text);
      piper.stdin.end();

      resolve({
        stream: audioStream,
        format: 'raw',
        sampleRate: 22050,
        channels: 1,
        bitDepth: 16
      });
    });
  }

  // Apply Raven's voice characteristics
  adjustForMood(mood) {
    const moodSettings = {
      neutral: { lengthScale: 1.1, noiseScale: 0.667, noiseW: 0.8 },
      annoyed: { lengthScale: 1.0, noiseScale: 0.5, noiseW: 0.9 },
      bored: { lengthScale: 1.3, noiseScale: 0.7, noiseW: 0.7 },
      sarcastic: { lengthScale: 1.05, noiseScale: 0.6, noiseW: 0.85 },
      reluctant: { lengthScale: 1.2, noiseScale: 0.7, noiseW: 0.75 }
    };

    const settings = moodSettings[mood] || moodSettings.neutral;
    this.voiceSettings = { ...this.voiceSettings, ...settings };

    return settings;
  }

  // Prepare text for better TTS output
  preprocessText(text) {
    // Add pauses for Raven's characteristic speech patterns
    let processed = text;

    // Add slight pause after ellipses
    processed = processed.replace(/\.\.\./g, '...<break time="300ms"/>');

    // Add pause after sighs
    processed = processed.replace(/\*sigh\*/gi, '<break time="500ms"/>');

    // Slow down emphasized words (wrapped in *)
    processed = processed.replace(/\*([^*]+)\*/g, '<emphasis>$1</emphasis>');

    return processed;
  }

  // Clean up old audio files
  async cleanup(maxAge = 3600000) { // Default 1 hour
    if (!fs.existsSync(this.outputDir)) return;

    const files = fs.readdirSync(this.outputDir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      if (!file.startsWith('raven_')) continue;

      const filePath = path.join(this.outputDir, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }

    return cleaned;
  }

  // Get status
  getStatus() {
    return {
      initialized: this.initialized,
      piperPath: this.piperPath,
      modelPath: this.modelPath,
      modelExists: fs.existsSync(this.modelPath),
      outputDir: this.outputDir,
      voiceSettings: this.voiceSettings,
      virtualAudioDevice: this.virtualAudioDevice
    };
  }

  // Instructions for setting up Piper
  getSetupInstructions() {
    return `
Piper TTS Setup for Raven AI Assistant:

1. INSTALL PIPER:
   - Download from: https://github.com/rhasspy/piper/releases
   - Extract and add to your system PATH
   - Or set PIPER_PATH in your .env to the full path

2. DOWNLOAD VOICE MODEL:
   - Recommended for Raven: en_US-lessac-medium (neutral, clear voice)
   - Alternative: en_GB-southern_english_female-low (lower pitch)
   - Download .onnx and .onnx.json files
   - Place in: ./models/ directory

3. CONFIGURE AUDIO ROUTING:
   a. Install Virtual Audio Cable:
      - Windows: VB-Audio Virtual Cable
      - macOS: BlackHole
      - Linux: PulseAudio null sink

   b. Route Piper output to virtual cable:
      - Set system audio output to virtual cable
      - Or use specific audio libraries to route directly

   c. VSeeFace input:
      - Set microphone to virtual cable output
      - Enable audio-based lip sync

4. VOICE SETTINGS FOR RAVEN:
   - Length Scale: 1.1 (slightly slower for deadpan)
   - Noise Scale: 0.667 (clear speech)
   - Noise W: 0.8 (natural variation)

Current Configuration:
- Model Path: ${this.modelPath}
- Model Exists: ${fs.existsSync(this.modelPath) ? 'Yes' : 'No - REQUIRED'}
- Output Directory: ${this.outputDir}
- Virtual Audio Device: ${this.virtualAudioDevice}
    `.trim();
  }
}

export default PiperTTS;
