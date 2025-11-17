// Wardrobe Management System for Raven AI Assistant
// Manages VRM outfits and accessories for the avatar

import fs from 'fs';
import path from 'path';

export class WardrobeManager {
  constructor(wardrobePath = './assets/wardrobe') {
    this.wardrobePath = wardrobePath;
    this.currentOutfit = null;
    this.outfits = new Map();
    this.accessories = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (!fs.existsSync(this.wardrobePath)) {
      fs.mkdirSync(this.wardrobePath, { recursive: true });
      console.log(`Created wardrobe directory: ${this.wardrobePath}`);

      // Create subdirectories
      fs.mkdirSync(path.join(this.wardrobePath, 'outfits'), { recursive: true });
      fs.mkdirSync(path.join(this.wardrobePath, 'accessories'), { recursive: true });
      fs.mkdirSync(path.join(this.wardrobePath, 'presets'), { recursive: true });
    }

    await this.scanWardrobe();
    await this.loadPresets();
    this.initialized = true;

    return this;
  }

  async scanWardrobe() {
    // Scan outfits directory
    const outfitsDir = path.join(this.wardrobePath, 'outfits');
    if (fs.existsSync(outfitsDir)) {
      const files = fs.readdirSync(outfitsDir);

      for (const file of files) {
        if (this.isVRMFile(file)) {
          const name = path.basename(file, path.extname(file));
          const filePath = path.join(outfitsDir, file);
          const stats = fs.statSync(filePath);

          this.outfits.set(name, {
            name,
            file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime,
            tags: this.extractTagsFromName(name)
          });
        }
      }
    }

    // Scan accessories directory
    const accessoriesDir = path.join(this.wardrobePath, 'accessories');
    if (fs.existsSync(accessoriesDir)) {
      const files = fs.readdirSync(accessoriesDir);

      for (const file of files) {
        if (this.isVRMFile(file) || this.isGLTFFile(file)) {
          const name = path.basename(file, path.extname(file));
          const filePath = path.join(accessoriesDir, file);
          const stats = fs.statSync(filePath);

          this.accessories.set(name, {
            name,
            file,
            path: filePath,
            size: stats.size,
            modified: stats.mtime,
            tags: this.extractTagsFromName(name)
          });
        }
      }
    }

    console.log(`Wardrobe scanned: ${this.outfits.size} outfits, ${this.accessories.size} accessories`);
  }

  isVRMFile(filename) {
    return filename.toLowerCase().endsWith('.vrm');
  }

  isGLTFFile(filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.gltf') || ext.endsWith('.glb');
  }

  extractTagsFromName(name) {
    // Extract tags from naming convention: outfit_casual_dark_summer
    const parts = name.toLowerCase().split(/[_-]/);
    const commonTags = ['casual', 'formal', 'punk', 'goth', 'dark', 'light', 'summer', 'winter', 'spring', 'autumn', 'halloween', 'christmas', 'elegant', 'sporty'];
    return parts.filter(part => commonTags.includes(part));
  }

  async loadPresets() {
    const presetsFile = path.join(this.wardrobePath, 'presets', 'config.json');

    if (fs.existsSync(presetsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(presetsFile, 'utf-8'));
        this.presets = data.presets || {};
        this.currentOutfit = data.currentOutfit || null;
      } catch (error) {
        console.warn('Failed to load presets:', error.message);
        this.presets = {};
      }
    } else {
      this.presets = {
        default: {
          outfit: null,
          accessories: []
        }
      };
      await this.savePresets();
    }
  }

  async savePresets() {
    const presetsDir = path.join(this.wardrobePath, 'presets');
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }

    const presetsFile = path.join(presetsDir, 'config.json');
    const data = {
      currentOutfit: this.currentOutfit,
      presets: this.presets,
      lastModified: new Date().toISOString()
    };

    fs.writeFileSync(presetsFile, JSON.stringify(data, null, 2));
  }

  // ===== OUTFIT MANAGEMENT =====

  listOutfits() {
    return Array.from(this.outfits.values()).map(o => ({
      name: o.name,
      file: o.file,
      tags: o.tags,
      modified: o.modified
    }));
  }

  listAccessories() {
    return Array.from(this.accessories.values()).map(a => ({
      name: a.name,
      file: a.file,
      tags: a.tags,
      modified: a.modified
    }));
  }

  getOutfit(name) {
    return this.outfits.get(name) || null;
  }

  getCurrentOutfit() {
    return this.currentOutfit;
  }

  async changeOutfit(outfitName) {
    const outfit = this.outfits.get(outfitName);

    if (!outfit) {
      const available = Array.from(this.outfits.keys()).join(', ');
      throw new Error(`Outfit '${outfitName}' not found. Available: ${available}`);
    }

    this.currentOutfit = outfitName;
    await this.savePresets();

    // Return the outfit info for VTuber app to load
    return {
      success: true,
      outfit: {
        name: outfit.name,
        path: outfit.path,
        file: outfit.file
      },
      message: `Changed to ${outfitName}. How... transformative.`
    };
  }

  searchOutfits(query) {
    const queryLower = query.toLowerCase();
    const results = [];

    for (const outfit of this.outfits.values()) {
      if (
        outfit.name.toLowerCase().includes(queryLower) ||
        outfit.tags.some(tag => tag.includes(queryLower))
      ) {
        results.push(outfit);
      }
    }

    return results;
  }

  getOutfitsByTag(tag) {
    const tagLower = tag.toLowerCase();
    return Array.from(this.outfits.values()).filter(o =>
      o.tags.includes(tagLower)
    );
  }

  // ===== PRESETS =====

  async savePreset(name, config) {
    this.presets[name] = {
      outfit: config.outfit || this.currentOutfit,
      accessories: config.accessories || [],
      description: config.description || ''
    };

    await this.savePresets();
    return { success: true, preset: name };
  }

  async loadPreset(name) {
    const preset = this.presets[name];

    if (!preset) {
      throw new Error(`Preset '${name}' not found`);
    }

    if (preset.outfit) {
      await this.changeOutfit(preset.outfit);
    }

    return {
      success: true,
      outfit: preset.outfit,
      accessories: preset.accessories
    };
  }

  listPresets() {
    return Object.entries(this.presets).map(([name, config]) => ({
      name,
      outfit: config.outfit,
      accessories: config.accessories,
      description: config.description
    }));
  }

  // ===== STATUS =====

  getStatus() {
    return {
      initialized: this.initialized,
      wardrobePath: this.wardrobePath,
      outfitCount: this.outfits.size,
      accessoryCount: this.accessories.size,
      currentOutfit: this.currentOutfit,
      presetCount: Object.keys(this.presets).length
    };
  }

  // ===== RANDOM OUTFIT (for Raven's autonomous choices) =====

  pickRandomOutfit(excludeCurrent = true) {
    const outfitNames = Array.from(this.outfits.keys());

    if (outfitNames.length === 0) {
      return null;
    }

    let candidates = outfitNames;
    if (excludeCurrent && this.currentOutfit && outfitNames.length > 1) {
      candidates = outfitNames.filter(name => name !== this.currentOutfit);
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  pickOutfitByMood(mood) {
    // Map moods to tags
    const moodTagMap = {
      bored: ['casual', 'dark', 'goth'],
      annoyed: ['dark', 'punk', 'goth'],
      indifferent: ['casual', 'dark'],
      sarcastic: ['punk', 'dark', 'goth'],
      reluctant: ['casual', 'dark'],
      competent: ['formal', 'elegant', 'dark']
    };

    const tags = moodTagMap[mood] || ['casual'];
    const candidates = [];

    for (const tag of tags) {
      candidates.push(...this.getOutfitsByTag(tag));
    }

    if (candidates.length === 0) {
      return this.pickRandomOutfit();
    }

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex]?.name || this.pickRandomOutfit();
  }
}

export default WardrobeManager;
