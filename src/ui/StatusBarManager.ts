/*
 * StatusBarManager.ts
 *
 * Manages VS Code status bar integration for FocusMark extension.
 *
 * @version 1.0.2
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ConfigurationManager } from '../config/ConfigurationManager';

/**
 * StatusBarManager handles the VS Code status bar integration
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private isActive = false;

  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly logger: Logger
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'focusmark.toggleFromStatusBar';
  }

  public show(): void {
    this.updateDisplay();
    this.logger.debug('Status bar item shown');
  }

  public hide(): void {
    this.statusBarItem.hide();
    this.logger.debug('Status bar item hidden');
  }

  /**
   * Sets the active state of the status bar indicator.
   * @param isActive - Whether the window is active.
   */
  public setActive(isActive: boolean): void {
    if (this.isActive === isActive) {
      return;
    }
    this.isActive = isActive;
    this.updateDisplay();
  }
  
  /**
   * Handle configuration changes
   */
  public onConfigurationChange(): void {
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const config = this.configManager.getConfiguration();
    // Hide the status bar indicator when either the extension or the indicator feature is disabled.
    if (!config.enabled) {
      this.hide();
      return;
    }
    
    const icon = this.isActive ? '$(check)' : '$(circle-slash)';
    const text = `FocusMark: ${this.isActive ? 'Active' : 'Inactive'}`;
    
    this.statusBarItem.text = `${icon} ${text}`;
    this.statusBarItem.tooltip = `Click to Toggle FocusMark (Currently ${text})`;
    
    const themeColor = this.configManager.getEffectiveColor();
    this.statusBarItem.color = this.isActive ? themeColor : undefined;
    this.statusBarItem.command = 'focusmark.toggleFromStatusBar';

    this.statusBarItem.show();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}

export default StatusBarManager; 
