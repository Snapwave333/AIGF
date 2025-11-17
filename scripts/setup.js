#!/usr/bin/env node

// Raven AI Assistant - Setup Script
// Creates necessary directories and checks dependencies

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 RAVEN AI ASSISTANT SETUP                     ║
╚═══════════════════════════════════════════════════════════════╝
`);

// Create required directories
const directories = [
  './assets/avatars',
  './assets/wardrobe/outfits',
  './assets/wardrobe/accessories',
  './assets/wardrobe/presets',
  './models',
  './credentials',
  './temp/audio'
];

console.log('Creating directories...');
for (const dir of directories) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  ✓ Created: ${dir}`);
  } else {
    console.log(`  - Exists: ${dir}`);
  }
}

// Check for .env file
console.log('\nChecking configuration...');
if (!fs.existsSync('.env')) {
  if (fs.existsSync('.env.example')) {
    fs.copyFileSync('.env.example', '.env');
    console.log('  ✓ Created .env from .env.example');
    console.log('  ! Please edit .env with your settings');
  } else {
    console.log('  ! .env file not found. Please create from .env.example');
  }
} else {
  console.log('  ✓ .env file exists');
}

// Check for Node.js version
console.log('\nChecking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion >= 18) {
  console.log(`  ✓ Node.js ${nodeVersion} (OK)`);
} else {
  console.log(`  ! Node.js ${nodeVersion} - Please upgrade to v18+`);
}

// Check for dependencies
console.log('\nChecking npm dependencies...');
if (fs.existsSync('./node_modules')) {
  console.log('  ✓ node_modules exists');
} else {
  console.log('  ! Run: npm install');
}

// Check external services
console.log('\nChecking external services...');

// Ollama
try {
  execSync('which ollama || where ollama 2>/dev/null', { stdio: 'pipe' });
  console.log('  ✓ Ollama is installed');

  // Check if Ollama is running
  try {
    const response = execSync('curl -s http://localhost:11434/api/tags 2>/dev/null || curl -s http://127.0.0.1:11434/api/tags', { encoding: 'utf-8', stdio: 'pipe' });
    if (response.includes('models')) {
      console.log('    ✓ Ollama service is running');

      // List available models
      const models = JSON.parse(response);
      if (models.models && models.models.length > 0) {
        console.log('    Available models:');
        models.models.slice(0, 5).forEach(m => {
          console.log(`      - ${m.name}`);
        });
      } else {
        console.log('    ! No models found. Run: ollama pull llama3:8b');
      }
    }
  } catch {
    console.log('    ! Ollama service not running. Run: ollama serve');
  }
} catch {
  console.log('  ! Ollama not found. Install from: https://ollama.ai');
}

// Piper TTS
try {
  execSync('which piper || where piper 2>/dev/null', { stdio: 'pipe' });
  console.log('  ✓ Piper TTS is installed');

  // Check for voice models
  const models = fs.readdirSync('./models').filter(f => f.endsWith('.onnx'));
  if (models.length > 0) {
    console.log('    Voice models found:');
    models.forEach(m => console.log(`      - ${m}`));
  } else {
    console.log('    ! No voice models. Download from: https://github.com/rhasspy/piper/releases');
  }
} catch {
  console.log('  ! Piper TTS not found (optional)');
  console.log('    Install from: https://github.com/rhasspy/piper');
}

// Google credentials
if (fs.existsSync('./credentials/google_credentials.json')) {
  console.log('  ✓ Google credentials found');

  if (fs.existsSync('./credentials/google_token.json')) {
    console.log('    ✓ Google OAuth token exists');
  } else {
    console.log('    ! Google OAuth not authorized yet');
    console.log('    Authorize via the dashboard after starting the server');
  }
} else {
  console.log('  ! Google credentials not found (optional)');
  console.log('    Setup at: https://console.cloud.google.com');
}

// VRM Avatar
const avatars = fs.readdirSync('./assets/avatars').filter(f => f.endsWith('.vrm'));
if (avatars.length > 0) {
  console.log('  ✓ VRM avatar(s) found:');
  avatars.forEach(a => console.log(`      - ${a}`));
} else {
  console.log('  ! No VRM avatars found');
  console.log('    Add .vrm files to ./assets/avatars/');
  console.log('    Free models at: https://hub.vroid.com/');
}

// Wardrobe outfits
const outfits = fs.readdirSync('./assets/wardrobe/outfits').filter(f => f.endsWith('.vrm'));
console.log(`  ${outfits.length > 0 ? '✓' : '!'} Wardrobe: ${outfits.length} outfit(s)`);

// Summary
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                      SETUP SUMMARY                           ║
╚═══════════════════════════════════════════════════════════════╝

Next steps:
1. Edit .env file with your configuration
2. Install Ollama and pull a model: ollama pull llama3:8b
3. (Optional) Install Piper TTS and download a voice
4. (Optional) Add VRM avatar files
5. (Optional) Setup Google API credentials
6. Run: npm start
7. Visit: http://localhost:3000/dashboard.html

For VTuber setup:
- Install VSeeFace (https://www.vseeface.icu/)
- Install virtual audio cable (VB-Audio)
- Configure audio routing for lip sync

"Oh. You're actually setting things up. How... industrious." - Raven
`);
