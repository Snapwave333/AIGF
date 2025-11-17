// VTuber Avatar Management System for Raven AI Assistant
// Handles VRM avatar state, expressions, and integration with VTuber apps

import fs from 'fs';
import path from 'path';
import { WardrobeManager } from './wardrobe-manager.js';

export class AvatarManager {
  constructor(config = {}) {
    this.modelPath = config.modelPath || './assets/avatars/raven.vrm';
    this.wardrobePath = config.wardrobePath || './assets/wardrobe';
    this.vtuberApp = config.vtuberApp || 'vseeFace';
    this.virtualAudioDevice = config.virtualAudioDevice || 'CABLE Input';

    this.wardrobe = new WardrobeManager(this.wardrobePath);
    this.currentExpression = 'neutral';
    this.currentPose = 'idle';
    this.state = {
      isSpeaking: false,
      emotion: 'indifferent',
      lastActivity: Date.now()
    };

    this.initialized = false;
  }

  async initialize() {
    await this.wardrobe.initialize();

    // Ensure avatar directories exist
    const avatarDir = path.dirname(this.modelPath);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    this.initialized = true;
    return this;
  }

  // ===== EXPRESSION SYSTEM =====
  // Maps Raven's emotional states to VRM blend shapes

  getExpressionMapping() {
    return {
      neutral: { preset: 'neutral', blendShapes: {} },
      indifferent: { preset: 'neutral', blendShapes: { 'eyeBrowDownLeft': 0.3, 'eyeBrowDownRight': 0.3 } },
      annoyed: { preset: 'angry', blendShapes: { 'eyeBrowDownLeft': 0.6, 'eyeBrowDownRight': 0.6 } },
      sarcastic: { preset: 'neutral', blendShapes: { 'eyeBrowDownLeft': 0.4, 'mouthSmileLeft': 0.2 } },
      bored: { preset: 'neutral', blendShapes: { 'eyeBlinkLeft': 0.3, 'eyeBlinkRight': 0.3 } },
      speaking: { preset: 'neutral', blendShapes: {} }, // Handled by lipsync
      thinking: { preset: 'neutral', blendShapes: { 'eyeLookUpLeft': 0.4, 'eyeLookUpRight': 0.4 } },
      reluctant: { preset: 'sad', blendShapes: { 'eyeBrowDownLeft': 0.2, 'eyeBrowDownRight': 0.2 } }
    };
  }

  setExpression(expressionName) {
    const mapping = this.getExpressionMapping();
    const expression = mapping[expressionName] || mapping.neutral;

    this.currentExpression = expressionName;

    return {
      expression: expressionName,
      preset: expression.preset,
      blendShapes: expression.blendShapes,
      timestamp: Date.now()
    };
  }

  // Automatically select expression based on text content
  inferExpressionFromText(text) {
    const textLower = text.toLowerCase();

    if (textLower.includes('fine') || textLower.includes('if i must')) {
      return 'reluctant';
    }
    if (textLower.includes('...') || textLower.includes('sigh')) {
      return 'bored';
    }
    if (textLower.includes('suppose') || textLower.includes('whatever')) {
      return 'indifferent';
    }
    if (textLower.includes('how dreadful') || textLower.includes('unfortunately')) {
      return 'annoyed';
    }
    if (textLower.includes('finally') || textLower.includes('peace')) {
      return 'sarcastic';
    }

    return 'neutral';
  }

  // ===== AVATAR STATE =====

  setSpeaking(isSpeaking) {
    this.state.isSpeaking = isSpeaking;
    this.state.lastActivity = Date.now();

    return {
      isSpeaking,
      expression: isSpeaking ? 'speaking' : this.currentExpression
    };
  }

  setEmotion(emotion) {
    this.state.emotion = emotion;
    this.setExpression(emotion);

    return {
      emotion,
      expression: this.currentExpression
    };
  }

  // ===== WARDROBE INTEGRATION =====

  async changeOutfit(outfitName) {
    return this.wardrobe.changeOutfit(outfitName);
  }

  listOutfits() {
    return this.wardrobe.listOutfits();
  }

  getCurrentOutfit() {
    return this.wardrobe.getCurrentOutfit();
  }

  pickOutfitByMood() {
    return this.wardrobe.pickOutfitByMood(this.state.emotion);
  }

  // ===== VTUBER APP INTEGRATION =====

  getVSeeFaceConfig() {
    return {
      app: 'VSeeFace',
      settings: {
        microphoneInput: this.virtualAudioDevice,
        modelPath: this.modelPath,
        trackingSource: 'webcam', // or 'iphone', 'none'
        autoStart: true,
        lipSyncMode: 'audio', // Uses virtual audio cable
        smoothing: 0.5,
        backgroundRemoval: false
      },
      hotkeys: {
        expression_neutral: 'Ctrl+1',
        expression_annoyed: 'Ctrl+2',
        expression_bored: 'Ctrl+3',
        toggleMic: 'Ctrl+M'
      }
    };
  }

  // Generate setup instructions for VSeeFace
  getSetupInstructions() {
    return `
VSeeFace Setup for Raven AI Assistant:

1. AUDIO ROUTING:
   - Install VB-Audio Virtual Cable (Windows) or BlackHole (macOS)
   - In VSeeFace, set microphone input to: ${this.virtualAudioDevice}
   - Configure your TTS to output to the virtual cable

2. MODEL SETUP:
   - Load VRM model from: ${this.modelPath}
   - Configure tracking (webcam for face tracking, or disable for AI-only)

3. LIP SYNC:
   - Enable audio-based lip sync in VSeeFace settings
   - VSeeFace will automatically animate mouth based on audio input

4. EXPRESSIONS:
   - Set up expression hotkeys for different moods
   - Raven will send expression commands via the API

5. WARDROBE:
   - Place VRM outfit files in: ${this.wardrobePath}/outfits/
   - Place accessory files in: ${this.wardrobePath}/accessories/
   - The system will scan and make them available to Raven

Current Status:
- Avatar Model: ${fs.existsSync(this.modelPath) ? 'Found' : 'NOT FOUND - Please add VRM file'}
- Outfits Available: ${this.wardrobe.outfits?.size || 0}
- Current Outfit: ${this.wardrobe.getCurrentOutfit() || 'None'}
- Virtual Audio: ${this.virtualAudioDevice}
    `.trim();
  }

  // ===== STATUS =====

  getStatus() {
    return {
      initialized: this.initialized,
      modelPath: this.modelPath,
      modelExists: fs.existsSync(this.modelPath),
      vtuberApp: this.vtuberApp,
      virtualAudioDevice: this.virtualAudioDevice,
      currentExpression: this.currentExpression,
      currentPose: this.currentPose,
      state: this.state,
      wardrobe: this.wardrobe.getStatus()
    };
  }

  // ===== COMMANDS FOR VTUBER APP =====

  // Generate OSC commands for VTuber apps that support it
  generateOSCCommand(type, value) {
    // OSC protocol for avatar control
    // VSeeFace and other apps support OSC for remote control
    return {
      address: `/avatar/${type}`,
      args: [value],
      timestamp: Date.now()
    };
  }

  // Create a batch of commands for a complete state update
  getStateUpdateCommands() {
    return {
      expression: this.generateOSCCommand('expression', this.currentExpression),
      speaking: this.generateOSCCommand('speaking', this.state.isSpeaking ? 1 : 0),
      emotion: this.generateOSCCommand('emotion', this.state.emotion)
    };
  }
}

export default AvatarManager;
