/*
 * WindowIdentifier.ts
 *
 * Generates and manages unique identifiers for VS Code windows.
 *
 * Design decisions:
 * - Uses nanoid for cryptographically secure, URL-safe IDs
 * - Combines workspace info with random ID for uniqueness
 * - Shorter IDs for better readability in logs and titles
 * 
 * @version 1.0.0
 */

import { nanoid } from 'nanoid';
import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';

/**
 * WindowIdentifier manages unique IDs for VS Code windows
 */
export class WindowIdentifier {
  private static currentWindowId: string | null = null;
  private static workspaceId: string | null = null;
  private static logger: Logger | null = null;

  /**
   * Generate a unique window identifier
   */
  public static generateWindowId(): string {
    if (WindowIdentifier.currentWindowId) {
      return WindowIdentifier.currentWindowId;
    }

    // Use shorter nanoid for readability (8 characters, URL-safe)
    const randomId = nanoid(8);
    
    // Include workspace information if available
    const workspaceName = WindowIdentifier.getWorkspaceName();
    const timestamp = Date.now().toString(36); // Base36 for compactness
    
    // Format: workspaceName-randomId-timestamp
    WindowIdentifier.currentWindowId = workspaceName 
      ? `${workspaceName}-${randomId}-${timestamp}`
      : `vscode-${randomId}-${timestamp}`;

    WindowIdentifier.logInfo(`Generated window ID: ${WindowIdentifier.currentWindowId}`);
    return WindowIdentifier.currentWindowId;
  }

  /**
   * Get the current window ID (generate if not exists)
   */
  public static getCurrentWindowId(): string {
    return WindowIdentifier.currentWindowId || WindowIdentifier.generateWindowId();
  }

  /**
   * Generate a workspace identifier based on workspace folders
   */
  public static generateWorkspaceId(): string {
    if (WindowIdentifier.workspaceId) {
      return WindowIdentifier.workspaceId;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      WindowIdentifier.workspaceId = 'no-workspace';
      return WindowIdentifier.workspaceId;
    }

    // Use first workspace folder path hash for consistency
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath || '';
    const workspaceName = WindowIdentifier.getWorkspaceName();
    
    // Create a deterministic hash from workspace path
    const pathHash = WindowIdentifier.simpleHash(workspacePath);
    
    WindowIdentifier.workspaceId = workspaceName 
      ? `${workspaceName}-${pathHash}`
      : `workspace-${pathHash}`;

    WindowIdentifier.logInfo(`Generated workspace ID: ${WindowIdentifier.workspaceId}`);
    return WindowIdentifier.workspaceId;
  }

  /**
   * Get the current workspace ID (generate if not exists)
   */
  public static getCurrentWorkspaceId(): string {
    return WindowIdentifier.workspaceId || WindowIdentifier.generateWorkspaceId();
  }

  /**
   * Get workspace name from the first workspace folder
   */
  private static getWorkspaceName(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    // Extract directory name from path
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      return null;
    }
    
    const pathParts = workspacePath.split(/[/\\]/);
    const workspaceName = pathParts[pathParts.length - 1];
    
    // Sanitize for use in identifiers (remove special characters)
    return workspaceName?.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null;
  }

  /**
   * Create a simple hash from a string (for workspace paths)
   */
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to base36 and take first 6 characters
    return Math.abs(hash).toString(36).substring(0, 6);
  }

  /**
   * Reset identifiers (useful for testing or workspace changes)
   */
  public static reset(): void {
    WindowIdentifier.currentWindowId = null;
    WindowIdentifier.workspaceId = null;
    WindowIdentifier.logInfo('Window and workspace identifiers reset');
  }

  /**
   * Get debug information about current identifiers
   */
  public static getDebugInfo(): { windowId: string; workspaceId: string; workspaceName: string | null } {
    return {
      windowId: WindowIdentifier.getCurrentWindowId(),
      workspaceId: WindowIdentifier.getCurrentWorkspaceId(),
      workspaceName: WindowIdentifier.getWorkspaceName()
    };
  }

  /**
   * Set the logger instance to reuse the extension's output channel
   */
  public static setLogger(logger: Logger): void {
    WindowIdentifier.logger = logger;
  }

  /**
   * Detach the logger (useful during extension shutdown)
   */
  public static clearLogger(): void {
    WindowIdentifier.logger = null;
  }

  private static logInfo(message: string): void {
    WindowIdentifier.logger?.info(message);
  }
}

export default WindowIdentifier; 
