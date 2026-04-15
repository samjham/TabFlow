/**
 * Tab Card (a.k.a. "tab tile")
 *
 * Single card in the new-tab grid — shows a tab's thumbnail (or favicon
 * placeholder), title, URL, a selection checkbox, and a remove button.
 * Implements the backlit-glow hover/press effect described in CLAUDE.md
 * §9 (the hard-edge glow Sam flagged).
 *
 * Extracted from NewTab.tsx on 2026-04-15 as part of the component split.
 * Props stayed identical to the original inline definition so NewTab.tsx
 * didn't need any call-site changes.
 */

import React, { useState } from 'react';
import type { Tab } from '@tabflow/core';
import { styles } from './styles';

export interface TabCardProps {
  tab: Tab;
  accentColor: string;
  selected: boolean;
  thumbnailUrl?: string;
  onToggleSelect: () => void;
  onClick: () => void;
  onRemove: () => void;
}

export const TabCard: React.FC<TabCardProps> = ({ tab, accentColor, selected, thumbnailUrl, onToggleSelect, onClick, onRemove }) => {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const getFaviconUrl = (url: string, faviconUrl?: string): string => {
    if (faviconUrl) return faviconUrl;
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain=${urlObj.hostname}`;
    } catch {
      return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b8fa3"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>';
    }
  };

  const truncateUrl = (url: string, maxLength: number = 50): string => {
    return url.length > maxLength ? url.substring(0, maxLength) + '...' : url;
  };

  const showThumbnail = thumbnailUrl && !thumbError;

  // Backlit glow effect:
  // - No hover: no glow (tile flat, dark)
  // - Hover: tight glow leaking around edges (tile flush against background)
  // - Pressed: tile lifts off — glow spreads wide, dark shadow cast below, slight scale-up
  const glowStyle: React.CSSProperties = pressed
    ? {
        border: '1px solid transparent',
        boxShadow: [
          // All blur, no spread — pure soft glow like a backlit LED
          `0 0 20px 0px ${accentColor}50`,
          `0 0 40px 0px ${accentColor}35`,
          `0 0 70px 0px ${accentColor}25`,
          `0 0 110px 0px ${accentColor}15`,
          `0 0 160px 0px ${accentColor}08`,
          // Cast shadow — grounds the lift
          `0 10px 30px 0px rgba(0, 0, 0, 0.4)`,
        ].join(', '),
        transform: 'translateY(-5px) scale(1.015)',
        filter: 'brightness(1.08)',
      }
    : hover
    ? {
        border: '1px solid transparent',
        boxShadow: `0 0 12px 0px ${accentColor}30, 0 0 25px 0px ${accentColor}15`,
      }
    : {};

  return (
    <div
      style={{
        ...styles.tabCard,
        borderTop: `3px solid ${accentColor}`,
        ...(hover ? styles.tabCardHover : {}),
        ...glowStyle,
        ...(selected ? { outline: `2px solid ${accentColor}`, outlineOffset: '-2px' } : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={(e) => {
        // Only glow on left-click, and not on checkbox/button clicks
        if (e.button === 0) setPressed(true);
      }}
      onMouseUp={() => setPressed(false)}
      onClick={onClick}
    >
      {/* Thumbnail preview area */}
      <div style={styles.tabThumbnailArea}>
        {showThumbnail ? (
          <img
            src={thumbnailUrl}
            style={styles.tabThumbnailImg}
            alt=""
            onError={() => setThumbError(true)}
          />
        ) : (
          <div style={styles.tabThumbnailPlaceholder}>
            <img
              src={getFaviconUrl(tab.url, tab.faviconUrl)}
              style={{ width: '32px', height: '32px', borderRadius: '4px', opacity: 0.5 }}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        {/* Overlay controls on thumbnail */}
        <div style={{
          ...styles.tabThumbnailOverlay,
          opacity: 1,
        }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            onClick={(e) => e.stopPropagation()}
            style={styles.tabCheckbox}
            title="Select tab"
          />
          <button
            style={{
              ...styles.tabRemoveButton,
              opacity: hover ? 1 : 0,
              pointerEvents: hover ? 'auto' : 'none',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove tab"
          >
            ✕
          </button>
        </div>
      </div>
      <div style={styles.tabCardContent}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <img
            src={getFaviconUrl(tab.url, tab.faviconUrl)}
            style={{ width: '14px', height: '14px', borderRadius: '2px', flexShrink: 0 }}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <h3 style={styles.tabTitle}>{tab.title || 'Untitled'}</h3>
        </div>
        <p style={styles.tabUrl}>{truncateUrl(tab.url)}</p>
      </div>
    </div>
  );
};
