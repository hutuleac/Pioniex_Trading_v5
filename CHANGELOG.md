# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [4.1.0] — 2026-03-21

### Changed
- Refactored monolithic `index.html` (~1,481 lines) into ES module architecture
- Extracted CSS to `css/style.css`
- Split JS into 5 modules: `config.js`, `api.js`, `indicators.js`, `ui.js`, `app.js`
- Added `deriveConditions()` private helper to eliminate duplicate boolean logic shared between `interpretSignals` and `calcScore`
- Replaced all `onclick=` attributes with `addEventListener` in `app.js`
- Event delegation on `#sym-chips` for dynamic symbol removal
- `fetchPriceFunding` now returns `provider` field; `app.js` sets `symProvider[name]` from it
- Header tooltip IIFE converted to `initHeaderTooltips()` function

## [4.0.0] — prior
- Original monolithic single-file implementation
