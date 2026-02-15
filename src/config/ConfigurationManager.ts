/*
 * Configuration Manager for FocusMark extension
 * 
 * Handles all VS Code settings with type safety and validation.
 * Provides a clean interface for accessing and updating configuration.
 * 
 * Design decisions:
 * - Type-safe configuration access
 * - Runtime validation using lightweight local guards
 * - Clean separation from VS Code API details
 * - Comprehensive error handling
 * 
 * @version 0.1.0
 */

import * as vscode from 'vscode';
import { ColorGenerator, THEME_COLORS } from '../theming/ColorGenerator';

export type ThemeType = 'auto' | 'orange' | 'blue' | 'green' | 'purple' | 'custom';

/**
 * Complete configuration interface
 */
export interface FocusMarkConfig {
  enabled: boolean;
  enableColors: boolean;
  theme: ThemeType;
  customColor: string;
  keepInactiveWindowColors: boolean;
  fullColorMode: boolean;
  activeApplyDelay: number;
  coordinationScope: 'global' | 'workspace';
  title: {
    indicator: string;
  };
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

const VALID_THEMES: ReadonlySet<ThemeType> = new Set([
  'auto',
  'orange',
  'blue',
  'green',
  'purple',
  'custom'
]);

/**
 * Validate hex color format
 */
function isValidHexColor(value: string): boolean {
  const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexPattern.test(value);
}

function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '#FF6B35';
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * Configuration Manager class
 * 
 * Provides type-safe access to VS Code configuration with validation
 * and smart defaults. Handles all configuration-related operations.
 */
export class ConfigurationManager {
  private static readonly EXTENSION_SECTION = 'focusmark';
  
  constructor() {
    // The 'onDidChangeConfiguration' is handled by the consumer of this class
  }

  /**
   * Get current complete configuration with defaults
   */
  getConfiguration(): FocusMarkConfig {
    const config = this.getVSCodeConfiguration();

    const fullColorModeRaw = config.get('fullColorMode');
    const legacyMinimalModeRaw = config.get('minimalMode');
    const fullColorMode =
      typeof fullColorModeRaw === 'boolean'
        ? fullColorModeRaw
        : typeof legacyMinimalModeRaw === 'boolean'
          ? !legacyMinimalModeRaw
          : false;

    return {
      enabled: config.get('enabled', true),
      enableColors: config.get('enableColors', true),
      theme: this.validateTheme(config.get('theme', 'auto')),
      customColor: this.validateHexColor(config.get('customColor', '#FF6B35')),
      keepInactiveWindowColors: config.get('keepInactiveWindowColors', false),
      fullColorMode,
      activeApplyDelay: this.validateDelay(config.get('activeApplyDelay', 100), 500),
      logLevel: this.validateLogLevel(config.get('logLevel', 'info')),
      coordinationScope: config.get('coordinationScope', 'global'),
      title: {
        indicator: config.get('title.indicator', '◉')
      }
    };
  }

  /**
   * Check if the extension is enabled
   */
  isEnabled(): boolean {
    return this.getVSCodeConfiguration().get('enabled', true);
  }

  /**
   * Set extension enabled state
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.updateConfiguration('enabled', enabled);
  }

  /**
   * Get current theme setting
   */
  getTheme(): ThemeType {
    const theme = this.getVSCodeConfiguration().get('theme', 'auto');
    return this.validateTheme(theme);
  }

  /**
   * Set theme configuration
   */
  async setTheme(theme: string): Promise<void> {
    const validatedTheme = this.validateTheme(theme);
    await this.updateConfiguration('theme', validatedTheme);
  }

  /**
   * Get custom color setting
   */
  getCustomColor(): string {
    const color = this.getVSCodeConfiguration().get('customColor', '#FF6B35');
    return this.validateHexColor(color);
  }

  /**
   * Set custom color configuration
   */
  async setCustomColor(color: string): Promise<void> {
    const validatedColor = this.validateHexColor(color);
    await this.updateConfiguration('customColor', validatedColor);
  }

  /**
   * Set title indicator configuration
   */
  async setTitleIndicator(indicator: string): Promise<void> {
    await this.updateConfiguration('title.indicator', indicator);
  }

  /**
   * Get the effective color for the current theme
   * 
   * Resolves theme to actual hex color, including auto-generation for 'auto' theme
   */
  getEffectiveColor(): string {
    const theme = this.getTheme();
    
    switch (theme) {
      case 'orange':
      case 'blue':
      case 'green':
      case 'purple':
        return THEME_COLORS[theme];
      case 'custom':
        return this.getCustomColor();
      case 'auto':
      default:
        return ColorGenerator.generateAutoColorFromWorkspace();
    }
  }

  /**
   * Listen for configuration changes
   */
  onConfigurationChange(callback: (changedKeys: string[]) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(ConfigurationManager.EXTENSION_SECTION)) {
        // Determine which specific keys changed
        const changedKeys = this.getChangedConfigurationKeys(event);
        callback(changedKeys);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // No-op - consumer manages its own subscriptions
  }

  /**
   * Get VS Code configuration section
   */
  private getVSCodeConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(ConfigurationManager.EXTENSION_SECTION);
  }

  /**
   * Update a configuration value
   */
  private async updateConfiguration(key: string, value: unknown): Promise<void> {
    try {
      const config = this.getVSCodeConfiguration();
      const inspection = config.inspect(key);
      const target = inspection?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await config.update(key, value, target);
    } catch (error) {
      throw new Error(`Failed to update configuration '${key}': ${error}`);
    }
  }

  /**
   * Validate theme value with runtime type checking
   */
  private validateTheme(value: unknown): ThemeType {
    if (typeof value !== 'string' || !VALID_THEMES.has(value as ThemeType)) {
      return 'auto';
    }
    return value as ThemeType;
  }

  /**
   * Validate hex color value
   */
  private validateHexColor(value: unknown): string {
    if (typeof value !== 'string') {
      return '#FF6B35';
    }
    const normalized = normalizeHexColor(value);
    if (!isValidHexColor(normalized)) {
      return '#FF6B35';
    }
    return normalized;
  }

  private validateDelay(value: unknown, max: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > max) {
      return max;
    }

    return Math.round(value);
  }

  /**
   * Determine which configuration keys changed
   */
  private getChangedConfigurationKeys(event: vscode.ConfigurationChangeEvent): string[] {
    const keys = [
      'enabled',
      'enableColors',
      'theme',
      'customColor',
      'keepInactiveWindowColors',
      'fullColorMode',
      'minimalMode',
      'activeApplyDelay',
      'logLevel',
      'coordinationScope',
      'title.indicator'
    ];
    return keys.filter(key => 
      event.affectsConfiguration(`${ConfigurationManager.EXTENSION_SECTION}.${key}`)
    );
  }

  private validateLogLevel(value: unknown): 'error' | 'warn' | 'info' | 'debug' {
    if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') {
      return value;
    }
    return 'info';
  }

}
