/*
 * FocusMark Manager - Main Orchestrator
 * 
 * Coordinates all extension functionality using interaction-based activation
 * with clean file-based coordination similar to FocusMark architecture.
 * 
 * Design decisions:
 * - Interaction-based activation (typing/editing) not focus-based
 * - Simple file coordination without complex debouncing
 * - Clean state management with atomic operations
 * - Proper cleanup without aggressive resets
 * 
 * @version 2.0.0
 */

import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FocusMarkConfig, ConfigurationManager } from '../config/ConfigurationManager';
import { Logger } from '../utils/Logger';
import { ThemeManager } from '../theming/ThemeManager';
import { TitleManager } from '../ui/TitleManager';
import { StatusBarManager } from '../ui/StatusBarManager';
import { WindowIdentifier } from './WindowIdentifier';

// Simple coordination data structure
interface CoordinationData {
  activeWindowId: string;
  workspaceId?: string;
  timestamp: number;
}

/**
 * Main manager class that orchestrates all FocusMark functionality
 */
export class FocusMarkManager {
  private readonly windowId = WindowIdentifier.generateWindowId();
  private readonly workspaceId = WindowIdentifier.getCurrentWorkspaceId();
  private themeManager: ThemeManager;
  private titleManager: TitleManager;
  private statusBarManager: StatusBarManager;
  private isWindowActive = false;
  private lastActivatedAt = 0;
  private activeApplyTimer: NodeJS.Timeout | undefined;
  private deactivateTimer: NodeJS.Timeout | undefined;
  
  // File-based coordination
  private readonly coordinationFile: string;
  private fileWatcher?: fs.FSWatcher;
  private disposables: vscode.Disposable[] = [];
  private initialized = false;
  private initializing: Promise<void> | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configManager: ConfigurationManager,
    private readonly logger: Logger
  ) {
    this.logger.debug(`FocusMarkManager created with ID: ${this.windowId}`);
    
    // Initialize coordination file path using VS Code global storage (shared across windows)
    const globalStoragePath = this.context.globalStorageUri.fsPath;
    fs.ensureDirSync(globalStoragePath);
    this.coordinationFile = path.join(globalStoragePath, 'coordination.json');
    
    // Initialize all components
    this.themeManager = new ThemeManager(
      this.context.workspaceState,
      this.context.globalState,
      this.configManager,
      this.logger
    );
    this.titleManager = new TitleManager(this.logger);
    this.statusBarManager = new StatusBarManager(this.configManager, this.logger);

    // Subscribe to configuration changes
    this.disposables.push(
      this.configManager.onConfigurationChange((keys) => this.handleConfigurationChange(keys))
    );
  }

  /**
   * Initialize the extension functionality
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.initializeInternal();
    try {
      await this.initializing;
      this.initialized = true;
    } finally {
      this.initializing = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    this.logger.info('Initializing FocusMark manager...');
    
    try {
      // Restore any lingering theme changes from previous sessions
      this.logger.debug(`[${this.windowId}] 🧹 Ensuring clean theme state on startup`);
      const config = this.configManager.getConfiguration();
      const isEnabled = this.configManager.isEnabled();
      const isFocused = vscode.window.state.focused;
      await this.themeManager.ensureCleanStateOnStartup({
        preserveTheme: isEnabled && config.enableColors && (isFocused || config.keepInactiveWindowColors),
        forceDefaultInactive: isEnabled && config.enableColors && !config.keepInactiveWindowColors && !isFocused
      });
      
      this.setupInteractionHandling();
      this.setupCoordination();

      // Fast-start: apply theme immediately for focused windows to reduce startup flash.
      if (isEnabled && isFocused) {
        this.logger.debug(`[${this.windowId}] ⚡ Fast-start applying active appearance.`);
        this.clearDeactivateTimer();
        this.isWindowActive = true;
        await this.applyActiveAppearance();
        await this.notifyWindowActive();
      } else {
        await this.ensureInitialActiveState();
      }
      
      if (this.configManager.isEnabled()) {
        this.statusBarManager.show();
      } else {
        this.logger.info('FocusMark is disabled by configuration.');
      }
      
      // Add all disposables to context
      this.context.subscriptions.push(...this.disposables);
      
      this.logger.info('✅ FocusMark manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize FocusMark manager:', error);
      throw error;
    }
  }
  
  /**
   * Enable the extension functionality via command
   */
  async enable(skipConfigUpdate = false): Promise<void> {
    this.logger.info('Enabling FocusMark...');

    if (!skipConfigUpdate && !this.configManager.isEnabled()) {
      await this.configManager.setEnabled(true);
    }

    await this.initialize();
    this.clearDeactivateTimer();
    this.statusBarManager.show();

    if (vscode.window.state.focused) {
      await this.handleUserInteraction('enable-command');
    }
  }
  
  /**
   * Disable the extension functionality via command
   */
  async disable(skipConfigUpdate = false): Promise<void> {
    this.logger.info('Disabling FocusMark...');

    if (!skipConfigUpdate && this.configManager.isEnabled()) {
      await this.configManager.setEnabled(false);
    }
    this.clearDeactivateTimer();
    await this.deactivateWindow();
    await this.themeManager.restoreGlobalOriginalCustomizations();
    this.statusBarManager.hide();
  }

  /**
   * Public method to handle status bar click events
   */
  async handleStatusBarClick(): Promise<void> {
    this.logger.info('Handling status bar click...');
    const isEnabled = this.configManager.isEnabled();
    if (isEnabled) {
      await this.disable();
    } else {
      await this.enable();
    }
  }

  /**
   * Public method to reset color customizations
   */
  async resetColors(): Promise<void> {
    this.logger.info('Resetting all color customizations...');
    await this.themeManager.resetAllColors();
  }

  /**
   * Apply the current theme immediately from a user command.
   */
  async applyThemeFromCommand(): Promise<void> {
    if (!this.configManager.isEnabled() || !vscode.window.state.focused) {
      return;
    }

    this.clearDeactivateTimer();
    this.isWindowActive = true;

    await this.applyActiveAppearance();
    await this.notifyWindowActive();
  }

  /**
   * Clean up all resources
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing FocusMark manager');
    
    // Clean up file watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    this.clearActiveApplyTimer();
    this.clearDeactivateTimer();
    
    // Remove our coordination data if we're the active window
    await this.cleanupCoordinationFile();
    
    // Dispose all components
    this.disposables.forEach(d => d.dispose());
    this.statusBarManager.dispose();
    this.titleManager.dispose();
    await this.themeManager.dispose();
    
    this.logger.debug('FocusMark manager disposed successfully');
  }
  
  // =================================================================
  // Private Helper Methods
  // =================================================================

  /**
   * Set up interaction-based activation monitoring
   */
  private setupInteractionHandling(): void {
    // Monitor window focus changes (e.g., switching to the window)
    this.disposables.push(
      vscode.window.onDidChangeWindowState(async (windowState) => {
        if (!this.configManager.isEnabled()) {
          return;
        }

        if (windowState.focused) {
          await this.handleUserInteraction('window-focus');
          return;
        }

        // Window lost focus - keep the last active VS Code window colored.
        // Deactivation is handled when another VS Code window becomes active.
      })
    );

    // Monitor text selection changes (clicks, cursor movement)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(async (event) => {
        // We only care about user-initiated interactions
        if (event.kind && this.configManager.isEnabled()) {
          await this.handleUserInteraction('selection-change');
        }
      })
    );

    // Monitor active editor changes (file switching)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(async () => {
        if (this.configManager.isEnabled()) {
          // If the window is already active, we just need to update its title.
          if (this.isWindowActive) {
            const titleConfig = this.configManager.getConfiguration().title;
            this.applyTitleIndicator(titleConfig.indicator, true);
          } else {
            // Otherwise, this interaction should make the window active.
            await this.handleUserInteraction('editor-change');
          }
        }
      })
    );
  }

  /**
   * Set up file-based coordination system
   */
  private setupCoordination(): void {
    // Watch for coordination file changes from other windows
    this.startFileWatcher();
    
    // Start a backup poller as safety net
    this.startBackupPoller();
  }

  /**
   * Handle user interaction in this window
   */
  private async handleUserInteraction(interactionType: string): Promise<void> {
    this.logger.debug(`[${this.windowId}] 🎯 User interaction detected: ${interactionType}`);
    this.logger.debug(`[${this.windowId}] 📊 Current state - isWindowActive: ${this.isWindowActive}, themeActive: ${this.themeManager.isActive()}`);

    // If a deactivation is pending, cancel it and reassert activity.
    if (this.deactivateTimer) {
      this.logger.debug(`[${this.windowId}] ⏳ Pending deactivation canceled due to interaction: ${interactionType}`);
      this.clearDeactivateTimer();
      this.isWindowActive = false;
    }
    
    // Skip if already active
    if (this.isWindowActive) {
      this.logger.debug(`[${this.windowId}] ⏭️ Skipping ${interactionType} - window already active`);
      return;
    }
    
    this.logger.debug(`[${this.windowId}] 🚀 Activating window due to ${interactionType}`);
    await this.activateWindowAndNotify();
  }

  /**
   * Activate this window and notify other windows
   */
  private async activateWindowAndNotify(): Promise<void> {
    if (this.isWindowActive) {
      return;
    }

    this.clearDeactivateTimer();
    this.isWindowActive = true;

    const config = this.configManager.getConfiguration();
    await this.applyActiveAppearanceWithDelay(config);

    // Notify other windows to deactivate after we've applied our theme
    await this.notifyWindowActive();
  }

  /**
   * Deactivate this window
   */
  private async deactivateWindow(preserveTheme = false): Promise<void> {
    if (!this.isWindowActive && !this.themeManager.isActive()) {
      return;
    }
    
    this.isWindowActive = false;

    this.clearActiveApplyTimer();

    const config = this.configManager.getConfiguration();
    const forceDefaultInactive = !config.keepInactiveWindowColors;

    this.titleManager.setInactive();
    this.statusBarManager.setActive(false);

    if (!config.enableColors) {
      await this.themeManager.removeTheme(false, false);
      return;
    }

    const shouldPreserveTheme = preserveTheme && !forceDefaultInactive;
    if (!shouldPreserveTheme) {
      await this.themeManager.removeTheme(true, forceDefaultInactive);
    }
  }

  /**
   * Notify other windows that this window is active by writing to coordination file
   */
  private async notifyWindowActive(): Promise<void> {
    try {
      const now = Date.now();
      this.lastActivatedAt = now;
      const data: CoordinationData = {
        activeWindowId: this.windowId,
        workspaceId: this.workspaceId,
        timestamp: now,
      };
      
      this.logger.debug(`[${this.windowId}] 📝 Writing coordination data:`, data);
      
      // Use atomic write (temp file + rename) like FocusMark
      const tempFile = `${this.coordinationFile}.${this.windowId}.tmp`;
      await fs.writeJson(tempFile, data);
      await fs.rename(tempFile, this.coordinationFile);
      
      this.logger.debug(`[${this.windowId}] ✅ Coordination data written successfully to ${this.coordinationFile}`);
    } catch (error) {
      this.logger.error(`[${this.windowId}] ❌ Failed to write coordination data:`, error);
    }
  }

  /**
   * Start file watcher for coordination
   */
  private startFileWatcher(): void {
    const dir = path.dirname(this.coordinationFile);
    const basename = path.basename(this.coordinationFile);

    try {
      fs.ensureDirSync(dir);
      
      this.logger.debug(`[${this.windowId}] 👁️ Starting file watcher on ${dir} for file ${basename}`);
      
      this.fileWatcher = fs.watch(dir, async (eventType: string, filename: string | null) => {
        if (filename === basename) {
          this.logger.debug(`[${this.windowId}] 📁 File change detected: ${eventType} on ${filename}`);
          await this.handleCoordinationChange();
        }
      });

      this.logger.debug(`[${this.windowId}] ✅ File watcher started successfully`);
    } catch (error) {
      this.logger.error(`[${this.windowId}] ❌ Failed to start file watcher:`, error);
    }
  }

  /**
   * Start backup poller for coordination
   */
  private startBackupPoller(): void {
    const poller = setInterval(() => {
      this.logger.debug(`[${this.windowId}] 🔄 Backup poller checking coordination file`);
      this.handleCoordinationChange();
    }, 2000);
    this.disposables.push({ dispose: () => clearInterval(poller) });
    this.logger.debug(`[${this.windowId}] ⏰ Backup coordination poller started`);
  }

  /**
   * Handle coordination file changes
   */
  private async handleCoordinationChange(): Promise<void> {
    try {
      this.logger.debug(`[${this.windowId}] 🔍 Checking coordination file: ${this.coordinationFile}`);
      
      if (!(await fs.pathExists(this.coordinationFile))) {
        this.logger.debug(`[${this.windowId}] 📄 Coordination file does not exist`);
        return;
      }
      
      // Read file content safely
      let data: CoordinationData | null = null;
      try {
        const fileContent = await fs.readFile(this.coordinationFile, 'utf8');
        this.logger.debug(`[${this.windowId}] 📄 Raw file content:`, fileContent);
        
        if (fileContent.trim()) {
          data = JSON.parse(fileContent);
        } else {
          this.logger.debug(`[${this.windowId}] 📄 File is empty`);
          return;
        }
      } catch (_parseError) {
        this.logger.error(`[${this.windowId}] ❌ Failed to parse coordination file:`, _parseError);
        // Try to remove corrupted file
        try {
          await fs.remove(this.coordinationFile);
          this.logger.debug(`[${this.windowId}] 🗑️ Removed corrupted coordination file`);
        } catch (removeError) {
          this.logger.error(`[${this.windowId}] ❌ Failed to remove corrupted file:`, removeError);
        }
        return;
      }
      
      this.logger.debug(`[${this.windowId}] 📖 Read coordination data:`, data);

      if (!data || !data.activeWindowId || data.activeWindowId === this.windowId) {
        this.logger.debug(`[${this.windowId}] ⏭️ Ignoring - no data or our own update`);
        return; // Ignore our own updates or invalid data
      }

      if (vscode.window.state.focused) {
        this.logger.debug(`[${this.windowId}] 🛡️ Ignoring coordination change while window is focused`);
        return;
      }

      if (this.lastActivatedAt >= data.timestamp) {
        this.logger.debug(
          `[${this.windowId}] 🕒 Ignoring stale coordination data (local ${this.lastActivatedAt} >= remote ${data.timestamp})`
        );
        return;
      }
      
      this.logger.debug(`[${this.windowId}] 🔍 Another window active: ${data.activeWindowId}, checking if we need to deactivate`);
      this.logger.debug(`[${this.windowId}] 📊 Current state - themeActive: ${this.themeManager.isActive()}, isWindowActive: ${this.isWindowActive}`);
      
      if (this.isWindowActive || this.themeManager.isActive()) {
        const keepInactive = this.configManager.getConfiguration().keepInactiveWindowColors;
        const config = this.configManager.getConfiguration();
        const scope = config.coordinationScope ?? 'global';
        const sameWorkspace = !!data.workspaceId && data.workspaceId === this.workspaceId;
        if (scope === 'workspace' && !sameWorkspace) {
          this.logger.debug(
            `[${this.windowId}] 🛑 Coordination scope is workspace; ignoring window ${data.activeWindowId} from another workspace.`
          );
          return;
        }
        const preserveTheme = keepInactive && sameWorkspace;
        this.logger.debug(
          `Deactivating window because ${data.activeWindowId} became active${preserveTheme ? ' (preserving theme for shared workspace)' : ''}.`
        );
        await this.scheduleDeactivation(preserveTheme);
      }
    } catch (error) {
      this.logger.error(`[${this.windowId}] ❌ Failed to handle coordination change:`, error);
    }
  }

  /**
   * Clean up coordination file on disposal
   */
  private async cleanupCoordinationFile(): Promise<void> {
    try {
      if (await fs.pathExists(this.coordinationFile)) {
        try {
          const fileContent = await fs.readFile(this.coordinationFile, 'utf8');
          if (fileContent.trim()) {
            const data = JSON.parse(fileContent);
            if (data && data.activeWindowId === this.windowId) {
              await fs.remove(this.coordinationFile);
              this.logger.debug('Cleaned up coordination file');
            }
          }
        } catch (_parseError) {
          // If file is corrupted, just remove it
          await fs.remove(this.coordinationFile);
          this.logger.debug('Removed corrupted coordination file during cleanup');
        }
      }
    } catch (error) {
      this.logger.debug('Failed to cleanup coordination file', error);
    }
  }

  /**
   * Handle changes to the extension's configuration
   */
  private async handleConfigurationChange(changedKeys: string[]): Promise<void> {
    this.logger.debug(`Handling configuration change. Keys: ${changedKeys.join(', ')}`);

    if (changedKeys.includes('enabled')) {
      if (this.configManager.isEnabled()) {
        await this.enable(true);
      } else {
        await this.disable(true);
        return;
      }
    }

    // Update status bar display if its settings changed
    // Re-apply theme if theme settings changed
    if (changedKeys.some(key =>
      key.startsWith('theme') || key.startsWith('customColor') || key === 'fullColorMode' || key === 'minimalMode'
    )) {
      if (this.isWindowActive) {
        await this.applyActiveAppearance();
      }
    }

    if (changedKeys.includes('enableColors')) {
      const config = this.configManager.getConfiguration();
      if (!config.enableColors) {
        await this.themeManager.removeTheme(false, false);
      } else if (this.isWindowActive) {
        await this.applyActiveAppearance();
      } else {
        await this.themeManager.removeTheme(false, false);
      }
    }

    if (changedKeys.includes('keepInactiveWindowColors')) {
      const forceDefault = !this.configManager.getConfiguration().keepInactiveWindowColors;
      if (!this.isWindowActive) {
        await this.themeManager.removeTheme(false, forceDefault);
      }
    }

    if (changedKeys.includes('activeApplyDelay') && this.isWindowActive) {
      const config = this.configManager.getConfiguration();
      if (this.activeApplyTimer) {
        this.logger.debug('Active apply delay changed while timer pending. Rescheduling theme application.');
        this.scheduleActiveAppearance(config);
      }
    }

    // Update title if title settings changed
    if (changedKeys.some(key => key.startsWith('title'))) {
      const titleConfig = this.configManager.getConfiguration().title;
      this.applyTitleIndicator(titleConfig.indicator, this.isWindowActive);
    }
  }

  private async ensureInitialActiveState(): Promise<void> {
    if (!this.configManager.isEnabled()) {
      return;
    }

    if (!vscode.window.state.focused) {
      this.logger.debug(`[${this.windowId}] Window not focused on startup; awaiting interaction.`);
      return;
    }

    if (this.isWindowActive) {
      return;
    }

    this.logger.debug(`[${this.windowId}] Window starts focused; claiming active state.`);
    await this.handleUserInteraction('startup-focus');
  }

  private clearActiveApplyTimer(): void {
    if (this.activeApplyTimer) {
      clearTimeout(this.activeApplyTimer);
      this.activeApplyTimer = undefined;
    }
  }

  private clearDeactivateTimer(): void {
    if (this.deactivateTimer) {
      clearTimeout(this.deactivateTimer);
      this.deactivateTimer = undefined;
    }
  }

  private scheduleActiveAppearance(config: FocusMarkConfig): void {
    void this.applyActiveAppearanceWithDelay(config);
  }

  private async applyActiveAppearanceWithDelay(config: FocusMarkConfig): Promise<void> {
    this.clearActiveApplyTimer();

    const delay = config.activeApplyDelay;

    if (delay > 0) {
      this.logger.debug(`[${this.windowId}] Delaying active appearance by ${delay}ms`);
      await new Promise<void>((resolve) => {
        this.activeApplyTimer = setTimeout(async () => {
          this.activeApplyTimer = undefined;
          await this.applyActiveAppearance();
          resolve();
        }, delay);
      });
      return;
    }

    this.activeApplyTimer = undefined;
    await this.applyActiveAppearance();
  }

  private async applyActiveAppearance(): Promise<void> {
    if (!this.isWindowActive) {
      return;
    }

    const config = this.configManager.getConfiguration();
    if (!config.enableColors) {
      await this.themeManager.removeTheme(false, false);
      this.applyTitleIndicator(config.title.indicator, true);
      this.statusBarManager.setActive(true);
      return;
    }

    await this.themeManager.applyTheme();
    this.applyTitleIndicator(config.title.indicator, true);

    this.statusBarManager.setActive(true);
  }

  private async scheduleDeactivation(preserveTheme = false): Promise<void> {
    this.clearDeactivateTimer();
    await this.deactivateWindow(preserveTheme);
  }

  private applyTitleIndicator(indicator: string, isActive: boolean): void {
    if (!indicator?.trim()) {
      this.titleManager.reset();
      return;
    }

    if (isActive) {
      this.titleManager.setActive(indicator);
    } else {
      this.titleManager.setInactive();
    }
  }
}
