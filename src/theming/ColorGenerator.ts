/*
 * ColorGenerator.ts
 *
 * Generates color palettes and automatic colors for theming.
 *
 * @version 1.0.0
 */

import * as vscode from 'vscode';
import { colord } from 'colord';

type Theme = 'auto' | 'orange' | 'blue' | 'green' | 'purple' | 'custom';

/**
 * Pre-defined theme color mappings.
 * Exported for use in configuration and other UI components.
 */
export const THEME_COLORS: Record<Exclude<Theme, 'auto' | 'custom'>, string> = {
  orange: '#F57C00', // A vibrant, energetic orange
  blue: '#1976D2',   // A deep and calming blue
  green: '#388E3C',  // A rich, dark green
  purple: '#7B1FA2'  // A majestic and bold purple
};

const autoColorCache = new Map<string, string>();

/**
 * Handles the generation of colors for UI theming.
 */
export class ColorGenerator {
  /**
   * Generates a consistent color based on the workspace path.
   * This ensures that each project gets its own unique, stable color.
   * @returns A hex color string.
   */
  public static generateAutoColorFromWorkspace(): string {
    // Prioritize the workspace file for multi-root setups for a more stable ID.
    const workspaceFilePath = vscode.workspace.workspaceFile?.fsPath;

    // Use the first folder path as a fallback for single-folder workspaces.
    const firstFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const workspaceIdentifier = workspaceFilePath || firstFolderPath || 'no-workspace';
    const cacheKey = workspaceIdentifier;

    const cached = autoColorCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const uniqueIdentifier = workspaceIdentifier;

    // Generate a consistent hash from the unique identifier.
    let hash = 0;
    for (let i = 0; i < uniqueIdentifier.length; i++) {
      const char = uniqueIdentifier.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to a 32-bit integer
    }

    // Convert the hash to an HSL color for good color distribution.
    const hue = Math.abs(hash) % 360;
    const saturation = 65; // Fixed saturation for consistency
    const lightness = 55;  // Fixed lightness for readability

    const color = colord({ h: hue, s: saturation, l: lightness }).toHex();
    autoColorCache.set(cacheKey, color);
    return color;
  }
}
