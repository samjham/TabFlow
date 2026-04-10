#!/usr/bin/env node

/**
 * Icon generation script for TabFlow Chrome extension
 * Converts SVG icons to PNG files in multiple sizes
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTENSION_ROOT = path.join(__dirname, '..');
const SVG_SOURCE = path.join(EXTENSION_ROOT, 'public', 'icons', 'icon128.svg');
const OUTPUT_DIR = path.join(EXTENSION_ROOT, 'public', 'icons');

const SIZES = [16, 32, 48, 128];

async function generateIcons() {
  try {
    console.log('TabFlow Icon Generator');
    console.log('======================\n');

    // Check if source SVG exists
    if (!fs.existsSync(SVG_SOURCE)) {
      throw new Error(`Source SVG not found: ${SVG_SOURCE}`);
    }

    console.log(`Reading SVG from: ${SVG_SOURCE}`);
    const svgBuffer = fs.readFileSync(SVG_SOURCE);

    // Generate PNG icons for each size
    for (const size of SIZES) {
      const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);

      console.log(`Generating icon${size}.png (${size}x${size})...`);

      await sharp(svgBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ Created: ${outputPath}`);
    }

    console.log('\n✓ All icons generated successfully!');
    console.log(`Output directory: ${OUTPUT_DIR}`);
    process.exit(0);
  } catch (error) {
    console.error('✗ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();
