# TabFlow Icon Generation

## Overview
Created a complete icon system for the TabFlow Chrome extension using SVG source files and PNG exports.

## Files Created

### SVG Source Icons
Located in: `packages/chrome-extension/public/icons/`

- **icon16.svg** - 16x16px icon source
- **icon32.svg** - 32x32px icon source  
- **icon48.svg** - 48x48px icon source
- **icon128.svg** - 128x128px icon source (primary source)

**Design**: Overlapping rounded rectangles (3 stacked layers) representing browser tabs, using the brand color #6c8cff (blue-purple) with opacity variations to create depth.

### PNG Export Icons
Located in: `packages/chrome-extension/public/icons/`

- **icon16.png** - 16x16px (extension icon in toolbar - small)
- **icon32.png** - 32x32px (extension icon in toolbar - normal)
- **icon48.png** - 48x48px (extension icon in listings)
- **icon128.png** - 128x128px (extension icon in store/management pages)

All PNG files are generated from the SVG source using the icon generation script.

### Icon Generation Script
Location: `packages/chrome-extension/scripts/generate-icons.js`

- Reads the 128px SVG source file
- Generates all 4 PNG sizes (16, 32, 48, 128px)
- Uses Sharp library for high-quality PNG conversion
- Preserves transparency and renders at appropriate DPI

## Usage

### Generate/Regenerate Icons
```bash
cd packages/chrome-extension
npm run generate-icons
```

### Modify Design
1. Edit any of the SVG files in `public/icons/`
2. Run `npm run generate-icons` to regenerate all PNG files
3. SVG files serve as source of truth for design

## Manifest Configuration
The `manifest.json` is already configured to use the PNG icons:
- Extension action icon
- Extension management page icons
- All sizes properly mapped

## Dependencies
Added `sharp` (v0.33.5) as a devDependency for SVG-to-PNG conversion.

## Design Notes
- **Color**: #6c8cff (blue-purple) - brand color
- **Style**: Minimal, modern, clean
- **Concept**: Stacked tabs representing workspace organization
- **Opacity**: 3 layers with 50%, 75%, and 100% opacity for depth perception
- **Border Radius**: Proportionally sized for each icon size to maintain consistency

## Next Steps
1. Verify icons display correctly in Chrome extension
2. Consider creating additional icon variations (e.g., active/inactive states)
3. Test icon rendering at different DPI/pixel densities
