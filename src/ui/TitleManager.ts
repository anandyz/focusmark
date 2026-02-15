/*
 * TitleManager.ts
 *
 * Manages the VS Code window title, setting a consistent format
 * to indicate both the project and the window's active status.
 *
 * @version 2.0.0
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';

/**
 * Manages the VS Code window title to indicate active status.
 */
export class TitleManager {
  private originalTitle: string | undefined;
  private originalTitleCaptured = false;
  private lastSetTitle: string | undefined;
  private originalTitleTarget: vscode.ConfigurationTarget | undefined;
  private originalTitleHasValue = false;
  private appliedTarget: vscode.ConfigurationTarget | undefined;

  constructor(private readonly logger: Logger) {
    this.logger.debug(`TitleManager created.`);
  }

  /**
   * Applies the 'active' title format, including the indicator.
   * @param indicator The string or emoji to use.
   */
  public setActive(indicator: string): void {
    const newTitle = this.buildTitle(indicator);
    void this.updateTitleInConfig(newTitle);
    this.logger.debug(`Active title set: "${newTitle}"`);
  }

  /**
   * Applies the 'inactive' title format, without the indicator.
   */
  public setInactive(): void {
    const newTitle = this.buildTitle();
    void this.updateTitleInConfig(newTitle);
    this.logger.debug(`Inactive title set: "${newTitle}"`);
  }

  /**
   * Resets the window title to its default VS Code behavior.
   */
  public reset(): void {
    void this.restoreOriginalTitle();
    this.logger.debug(`Window title has been reset to the original user setting.`);
  }

  /**
   * Dynamically builds the title string by querying the workspace state.
   * @param indicator Optional indicator for the active state.
   * @returns The fully constructed title string.
   */
  private buildTitle(indicator?: string): string {
    const rootName = vscode.workspace.workspaceFolders?.[0]?.name;
    const activeEditor = vscode.window.activeTextEditor;
    const fileName = activeEditor ? path.basename(activeEditor.document.fileName) : '';

    const titleParts = [indicator];

    if (rootName) {
      titleParts.push(rootName);
    }
    
    if (fileName) {
      // Add a separator only if there was a root name before it.
      titleParts.push(rootName ? `- ${fileName}` : fileName);
    }

    return titleParts.filter(Boolean).join(' ');
  }

  /**
   * Updates the window title via the workspace configuration.
   * @param newTitle - The new title format to set, or undefined to reset.
   */
  private async updateTitleInConfig(newTitle: string | undefined): Promise<void> {
    const config = vscode.workspace.getConfiguration('window');
    const target = this.getConfigurationTarget();
    const currentTitle = config.get<string>('title');

    if (!this.originalTitleCaptured) {
      this.captureOriginalTitle(config);
      this.originalTitleCaptured = true;
    } else if (this.lastSetTitle !== undefined && currentTitle !== this.lastSetTitle) {
      this.captureOriginalTitle(config);
    }

    await config.update('title', newTitle, target);
    this.lastSetTitle = newTitle;
    this.appliedTarget = target;
  }

  private async restoreOriginalTitle(): Promise<void> {
    const config = vscode.workspace.getConfiguration('window');
    const targetTitle = this.originalTitleCaptured ? this.originalTitle : config.get<string>('title');
    const target = this.appliedTarget ?? this.getConfigurationTarget();
    const originalTarget = this.originalTitleTarget ?? target;

    if (originalTarget === vscode.ConfigurationTarget.Global) {
      if (target === vscode.ConfigurationTarget.Workspace) {
        await config.update('title', undefined, vscode.ConfigurationTarget.Workspace);
      }
      if (this.originalTitleHasValue) {
        await config.update('title', targetTitle, vscode.ConfigurationTarget.Global);
      } else {
        await config.update('title', undefined, vscode.ConfigurationTarget.Global);
      }
    } else {
      if (this.originalTitleHasValue) {
        await config.update('title', targetTitle, originalTarget);
      } else {
        await config.update('title', undefined, originalTarget);
      }
    }

    this.originalTitleCaptured = false;
    this.originalTitle = undefined;
    this.lastSetTitle = targetTitle;
    this.originalTitleTarget = undefined;
    this.originalTitleHasValue = false;
    this.appliedTarget = undefined;
  }

  private captureOriginalTitle(config: vscode.WorkspaceConfiguration): void {
    const inspect = config.inspect<string>('title');
    if (inspect?.workspaceValue !== undefined) {
      this.originalTitle = inspect.workspaceValue;
      this.originalTitleTarget = vscode.ConfigurationTarget.Workspace;
      this.originalTitleHasValue = true;
      return;
    }

    if (inspect?.globalValue !== undefined) {
      this.originalTitle = inspect.globalValue;
      this.originalTitleTarget = vscode.ConfigurationTarget.Global;
      this.originalTitleHasValue = true;
      return;
    }

    this.originalTitle = undefined;
    this.originalTitleTarget = vscode.ConfigurationTarget.Global;
    this.originalTitleHasValue = false;
  }

  private getConfigurationTarget(): vscode.ConfigurationTarget {
    const hasWorkspace = !!vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    return hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  }

  /**
   * Disposes of the TitleManager, ensuring the title is reset.
   */
  public dispose(): void {
    this.reset();
  }
}
