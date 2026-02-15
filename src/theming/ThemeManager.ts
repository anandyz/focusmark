/*
 * ThemeManager.ts
 *
 * Manages the application and removal of color themes to the VS Code UI,
 * creating a cohesive and accessible color scheme from a single base color.
 * It's designed to be similar in function to the Peacock extension.
 *
 * Design decisions:
 * - Generates a full palette (backgrounds, foregrounds, borders) from a base color.
 * - Automatically determines light/dark contrast for accessibility.
 * - Modifies a wide range of UI elements for a fully immersive theme.
 * - Cleans up all applied settings gracefully on removal or disposal.
 *
 * @version 2.0.0
 */

import * as vscode from 'vscode';
import { colord, extend } from 'colord';
import lch from 'colord/plugins/lch';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { Logger } from '../utils/Logger';

// Extend colord with the LCH plugin for better color manipulation
extend([lch]);

// A list of all workbench elements this extension will color.
// This is used to apply themes and to clean them up completely.
const AFFECTED_ELEMENTS = [
  'titleBar.activeBackground',
  'titleBar.activeForeground',
  'titleBar.inactiveBackground',
  'titleBar.inactiveForeground',
  'activityBar.background',
  'activityBar.foreground',
  'activityBar.inactiveForeground',
  'activityBar.border',
  'statusBar.background',
  'statusBar.foreground',
  'statusBar.border',
  'tab.activeBorderTop',
  'sideBar.border',
  'input.border',
  'focusBorder'
];

const MINIMAL_ELEMENTS: string[] = [
  'titleBar.activeBackground',
  'titleBar.activeForeground',
  'titleBar.inactiveBackground',
  'titleBar.inactiveForeground'
];

const THEME_STATE_KEY = 'focusmark.theme.originalCustomizations';
const THEME_APPLIED_KEY = 'focusmark.theme.applied';
const GLOBAL_THEME_STATE_KEY = 'focusmark.theme.globalOriginalCustomizations';

type StoredCustomizations = Record<string, string | null>;

/**
 * Manages the application of theme colors to the VS Code UI.
 */
export class ThemeManager {
  private isThemeApplied = false;
  private lastAppliedColor: string | undefined;
  private lastAppliedMinimal: boolean | undefined;
  private lastAppliedPalette: Record<string, string | undefined> | undefined;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly globalState: vscode.Memento,
    private readonly configManager: ConfigurationManager,
    private readonly logger: Logger
  ) {
    this.logger.debug('ThemeManager created');
  }

  /**
   * Applies the theme based on the current configuration.
   * If a theme is already applied, it's removed first to ensure a clean state.
   */
  public async applyTheme(): Promise<void> {
    const baseColor = this.configManager.getEffectiveColor();
    const fullColorMode = this.configManager.getConfiguration().fullColorMode;
    const minimalMode = !fullColorMode;
    this.logger.info(
      `Applying theme with base color: ${baseColor}${fullColorMode ? ' (full color mode)' : ' (minimal mode)'}`
    );

    if (this.isThemeApplied && this.lastAppliedColor === baseColor && this.lastAppliedMinimal === minimalMode) {
      this.logger.debug('Theme already applied with identical settings; skipping reapply.');
      return;
    }

    await this.ensureOriginalCustomizationsCaptured();
    await this.ensureGlobalOriginalCustomizationsCaptured();

    const resetKeys: Record<string, string | undefined> = {};
    for (const key of AFFECTED_ELEMENTS) {
      resetKeys[key] = undefined;
    }

    const newColorCustomizations = this.generateColorPalette(baseColor, minimalMode);
    this.lastAppliedPalette = this.buildAppliedPalette(baseColor, minimalMode);
    const workspaceTarget = this.getWorkspaceConfigurationTarget();
    if (workspaceTarget) {
      await this.applyColorsToWorkbench(
        { ...resetKeys, ...newColorCustomizations },
        workspaceTarget
      );
    }
    await this.applyColorsToWorkbench(
      { ...resetKeys, ...newColorCustomizations },
      vscode.ConfigurationTarget.Global
    );

    this.isThemeApplied = true;
    this.lastAppliedColor = baseColor;
    this.lastAppliedMinimal = minimalMode;
    await this.workspaceState.update(THEME_APPLIED_KEY, true);

    this.logger.debug(`Theme applied successfully${fullColorMode ? ' in full color mode' : ' in minimal mode'}.`);
  }

  /**
   * Removes the applied theme colors and resets the affected UI elements.
   * @param log - Whether to log the removal action.
   */
  public async removeTheme(log = true, forceDefaultInactive = false): Promise<void> {
    const storedCustomizations = this.getStoredCustomizations();

    if (!this.isThemeApplied && !storedCustomizations && !forceDefaultInactive) {
      return;
    }

    if (forceDefaultInactive) {
      if (log) {
        this.logger.info('Reverting inactive window to default VS Code colors...');
      }

      await this.ensureOriginalCustomizationsCaptured();
      await this.applyDefaultColors();
      await this.workspaceState.update(THEME_APPLIED_KEY, false);
    } else {
      if (log) {
        this.logger.info('Removing applied theme...');
      }

      await this.restoreOriginalCustomizations(storedCustomizations);
    }

    this.isThemeApplied = false;
    this.lastAppliedColor = undefined;
    this.lastAppliedMinimal = undefined;
    this.lastAppliedPalette = undefined;
    if (log) {
      this.logger.debug(
        forceDefaultInactive
          ? 'Inactive window colors reset to defaults.'
          : 'Theme removed successfully.'
      );
    }
  }

  /**
   * Resets all workbench color customizations modified by this extension.
   * This is a hard reset useful for cleanup.
   */
  public async resetAllColors(): Promise<void> {
    this.logger.info('Resetting all color customizations...');
    await this.removeTheme();
    await this.restoreGlobalOriginalCustomizations();
  }

  /**
   * Checks if a theme is currently applied.
   */
  public isActive(): boolean {
    return this.isThemeApplied;
  }

  /**
   * Disposes of the ThemeManager, ensuring a clean shutdown by removing the theme.
   */
  public async dispose(): Promise<void> {
    await this.removeTheme();
  }

  /**
   * Ensure we start from a clean state by restoring any lingering customizations.
   */
  public async ensureCleanStateOnStartup(options: {
    preserveTheme: boolean;
    forceDefaultInactive: boolean;
  }): Promise<void> {
    if (!this.workspaceState.get<boolean>(THEME_APPLIED_KEY)) {
      return;
    }

    if (options.preserveTheme) {
      this.logger.debug('Preserving FocusMark theme on startup for active window.');
      this.isThemeApplied = true;
      return;
    }

    if (options.forceDefaultInactive) {
      this.logger.debug('Window not focused on startup; resetting to default inactive colors.');
      await this.removeTheme(false, true);
      return;
    }

    this.logger.debug('Detected lingering FocusMark theme state. Restoring original colors.');
    await this.removeTheme(false);
  }

  private async ensureOriginalCustomizationsCaptured(): Promise<void> {
    if (this.getStoredCustomizations()) {
      return;
    }

    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    const workspaceTarget = this.getWorkspaceConfigurationTarget();
    const currentCustomizations =
      workspaceTarget
        ? ((inspect?.workspaceValue as Record<string, string | null> | undefined) || {})
        : ((inspect?.globalValue as Record<string, string | null> | undefined) || {});
    const stored: StoredCustomizations = {};

    for (const key of AFFECTED_ELEMENTS) {
      if (Object.prototype.hasOwnProperty.call(currentCustomizations, key)) {
        stored[key] = currentCustomizations[key] ?? null;
      } else {
        stored[key] = null;
      }
    }

    await this.workspaceState.update(THEME_STATE_KEY, stored);
  }

  private async ensureGlobalOriginalCustomizationsCaptured(): Promise<void> {
    if (this.getStoredGlobalCustomizations()) {
      return;
    }

    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    const globalCustomizations = (inspect?.globalValue as Record<string, string | null> | undefined) || {};
    const stored: StoredCustomizations = {};

    for (const key of AFFECTED_ELEMENTS) {
      if (Object.prototype.hasOwnProperty.call(globalCustomizations, key)) {
        stored[key] = globalCustomizations[key] ?? null;
      } else {
        stored[key] = null;
      }
    }

    await this.globalState.update(GLOBAL_THEME_STATE_KEY, stored);
  }

  private getStoredCustomizations(): StoredCustomizations | undefined {
    return this.workspaceState.get<StoredCustomizations>(THEME_STATE_KEY);
  }

  private getStoredGlobalCustomizations(): StoredCustomizations | undefined {
    return this.globalState.get<StoredCustomizations>(GLOBAL_THEME_STATE_KEY);
  }

  private async restoreOriginalCustomizations(stored: StoredCustomizations | undefined): Promise<void> {
    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    const workspaceTarget = this.getWorkspaceConfigurationTarget();
    const currentCustomizations =
      workspaceTarget
        ? ((inspect?.workspaceValue as Record<string, string | null> | undefined) || {})
        : ((inspect?.globalValue as Record<string, string | null> | undefined) || {});
    const updatedCustomizations: Record<string, string | null | undefined> = { ...currentCustomizations };
    const appliedPalette = this.lastAppliedPalette;

    if (stored) {
      for (const key of AFFECTED_ELEMENTS) {
        if (appliedPalette) {
          const appliedValue = appliedPalette[key];
          const currentValue = currentCustomizations[key];
          if (currentValue !== appliedValue) {
            continue;
          }
        }
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
          const original = stored[key];
          if (original === null || original === undefined) {
            delete updatedCustomizations[key];
          } else {
            updatedCustomizations[key] = original;
          }
        } else {
          delete updatedCustomizations[key];
        }
      }
    } else {
      for (const key of AFFECTED_ELEMENTS) {
        if (appliedPalette) {
          const appliedValue = appliedPalette[key];
          const currentValue = currentCustomizations[key];
          if (currentValue !== appliedValue) {
            continue;
          }
        }
        delete updatedCustomizations[key];
      }
    }

    const target = workspaceTarget ?? vscode.ConfigurationTarget.Global;
    await workbenchConfig.update('colorCustomizations', updatedCustomizations, target);
    await this.clearStoredCustomizations();
  }

  private async clearStoredCustomizations(): Promise<void> {
    await this.workspaceState.update(THEME_STATE_KEY, undefined);
    await this.workspaceState.update(THEME_APPLIED_KEY, false);
  }

  private async clearStoredGlobalCustomizations(): Promise<void> {
    await this.globalState.update(GLOBAL_THEME_STATE_KEY, undefined);
  }

  public async restoreGlobalOriginalCustomizations(): Promise<void> {
    const stored = this.getStoredGlobalCustomizations();
    if (!stored) {
      return;
    }

    const appliedPalette = this.lastAppliedPalette;
    if (!appliedPalette) {
      this.logger.debug('Skipping global restore because no applied palette is recorded.');
      return;
    }

    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    const globalCustomizations =
      (inspect?.globalValue as Record<string, string | null> | undefined) || {};
    const updatedCustomizations: Record<string, string | null | undefined> = { ...globalCustomizations };

    for (const key of AFFECTED_ELEMENTS) {
      const appliedValue = appliedPalette[key];
      const currentValue = globalCustomizations[key];
      if (currentValue !== appliedValue) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(stored, key)) {
        const original = stored[key];
        if (original === null || original === undefined) {
          delete updatedCustomizations[key];
        } else {
          updatedCustomizations[key] = original;
        }
      } else {
        delete updatedCustomizations[key];
      }
    }

    const hasKeys = Object.keys(updatedCustomizations).length > 0;
    await workbenchConfig.update(
      'colorCustomizations',
      hasKeys ? updatedCustomizations : undefined,
      vscode.ConfigurationTarget.Global
    );
    await this.clearStoredGlobalCustomizations();
  }

  private async applyDefaultColors(): Promise<void> {
    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    const workspaceTarget = this.getWorkspaceConfigurationTarget();
    const target = workspaceTarget ?? vscode.ConfigurationTarget.Global;
    const currentCustomizations =
      target === vscode.ConfigurationTarget.Global
        ? ((inspect?.globalValue as Record<string, string | null> | undefined) || {})
        : ((inspect?.workspaceValue as Record<string, string | null> | undefined) || {});
    const updatedCustomizations: Record<string, string | null | undefined> = { ...currentCustomizations };

    // Set explicit nulls so workspace (or global when no workspace) overrides values.
    for (const key of AFFECTED_ELEMENTS) {
      updatedCustomizations[key] = null;
    }

    await workbenchConfig.update('colorCustomizations', updatedCustomizations, target);
  }

  private buildAppliedPalette(baseColorHex: string, minimalMode: boolean): Record<string, string | undefined> {
    const palette = this.generateColorPalette(baseColorHex, minimalMode);
    const applied: Record<string, string | undefined> = {};
    for (const key of AFFECTED_ELEMENTS) {
      applied[key] = palette[key];
    }
    return applied;
  }

  /**
   * Generates a full color palette from a single base color.
   * @param baseColorHex - The hex string for the base color.
   * @returns A record of workbench color customization keys and their new color values.
   */
  private generateColorPalette(baseColorHex: string, minimalMode: boolean): Record<string, string> {
    const base = colord(baseColorHex);
    const isDark = base.isDark();

    // Determine contrasting foregrounds for high accessibility
    const foreground = isDark ? '#FFFFFF' : '#1E1E1E';
    const inactiveForeground = isDark ? base.lighten(0.3).saturate(0.2).toHex() : base.darken(0.3).desaturate(0.2).toHex();
    const inactiveBackground = isDark ? base.darken(0.1).toHex() : base.lighten(0.1).toHex();

    // Generate subtle borders by slightly darkening the base color
    const border = base.darken(0.08).toHex();

    const fullPalette: Record<string, string> = {
      'titleBar.activeBackground': baseColorHex,
      'titleBar.activeForeground': foreground,
      'titleBar.inactiveBackground': inactiveBackground,
      'titleBar.inactiveForeground': inactiveForeground,
      'activityBar.background': baseColorHex,
      'activityBar.foreground': foreground,
      'activityBar.inactiveForeground': inactiveForeground,
      'activityBar.border': border,
      'statusBar.background': baseColorHex,
      'statusBar.foreground': foreground,
      'statusBar.border': border,
      'tab.activeBorderTop': border,
      'sideBar.border': border,
      'input.border': border,
      'focusBorder': base.alpha(0.7).toHex(), // A semi-transparent border for focused elements
    };

    if (minimalMode) {
      const minimalPalette: Record<string, string> = {};
      for (const key of MINIMAL_ELEMENTS) {
        const value = fullPalette[key];
        if (value) {
          minimalPalette[key] = value;
        }
      }
      return minimalPalette;
    }

    return fullPalette;
  }

  /**
   * Applies a set of color customizations to the workspace settings.
   * @param colors - The color customizations to apply.
   */
  private async applyColorsToWorkbench(
    colors: Record<string, string | null | undefined>,
    target: vscode.ConfigurationTarget = this.getConfigurationTarget()
  ): Promise<void> {
    const workbenchConfig = vscode.workspace.getConfiguration('workbench');
    const inspect = workbenchConfig.inspect<Record<string, string | null>>('colorCustomizations');
    let currentCustomizations: Record<string, string | null> = {};

    if (target === vscode.ConfigurationTarget.Global) {
      currentCustomizations = (inspect?.globalValue as Record<string, string | null> | undefined) || {};
    } else if (target === vscode.ConfigurationTarget.Workspace) {
      currentCustomizations = (inspect?.workspaceValue as Record<string, string | null> | undefined) || {};
    } else if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
      currentCustomizations = (inspect?.workspaceFolderValue as Record<string, string | null> | undefined) || {};
    } else {
      currentCustomizations = workbenchConfig.get<Record<string, string | null>>('colorCustomizations') || {};
    }
    
    // Merge the new colors with any existing user customizations
    const newCustomizations: Record<string, string | null | undefined> = {
      ...currentCustomizations,
      ...colors
    };

    // Clean up undefined keys
    for (const key in newCustomizations) {
      if (newCustomizations[key] === undefined) {
        delete newCustomizations[key];
      }
    }

    if (this.areCustomizationsEqual(currentCustomizations, newCustomizations)) {
      this.logger.debug('Skipping color customization update (no changes detected).');
      return;
    }
    
    await workbenchConfig.update('colorCustomizations', newCustomizations, target);
  }

  private getConfigurationTarget(): vscode.ConfigurationTarget {
    return this.getWorkspaceConfigurationTarget() ?? vscode.ConfigurationTarget.Global;
  }

  private getWorkspaceConfigurationTarget(): vscode.ConfigurationTarget | null {
    const hasWorkspace = !!vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    return hasWorkspace ? vscode.ConfigurationTarget.Workspace : null;
  }

  private areCustomizationsEqual(
    current: Record<string, string | null | undefined>,
    next: Record<string, string | null | undefined>
  ): boolean {
    const currentKeys = Object.keys(current).filter(key => current[key] !== undefined).sort();
    const nextKeys = Object.keys(next).filter(key => next[key] !== undefined).sort();

    if (currentKeys.length !== nextKeys.length) {
      return false;
    }

    for (let i = 0; i < currentKeys.length; i += 1) {
      const key = currentKeys[i]!;
      const nextKey = nextKeys[i]!;
      if (key !== nextKey) {
        return false;
      }
      if (current[key] !== next[key]) {
        return false;
      }
    }

    return true;
  }
}
