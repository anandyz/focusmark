/*
 * Logger utility for FocusMark extension
 * 
 * Provides structured logging with different levels and VS Code output channel integration.
 * 
 * Design decisions:
 * - VS Code OutputChannel for user-visible logs
 * - Console fallback for development
 * - Configurable log levels for production vs development
 * - Clean API with consistent formatting
 * 
 * @version 0.1.0
 */

import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger class for structured logging with VS Code integration
 * 
 * Provides different log levels and integrates with VS Code's output panel
 * for better debugging and user feedback.
 */
export class Logger {
  private readonly outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = 'info';

  constructor(private readonly channelName: string) {
    this.outputChannel = vscode.window.createOutputChannel(this.channelName);
  }

  /**
   * Set the minimum log level for filtering messages
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Log debug message (development only)
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  /**
   * Log informational message
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  /**
   * Log error message with optional error object
   */
  error(message: string, error?: unknown, ...args: unknown[]): void {
    if (error instanceof Error) {
      this.log('error', `${message} ${error.message}`, error.stack, ...args);
    } else {
      this.log('error', message, error, ...args);
    }
  }

  /**
   * Show the output channel to the user
   */
  showOutputChannel(): void {
    this.outputChannel.show();
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }

  /**
   * Internal logging implementation
   * 
   * Handles message formatting and output to both VS Code channel and console
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formattedArgs = this.formatArguments(args);
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedArgs}`;
    
    // Output to VS Code channel
    this.outputChannel.appendLine(logMessage);
    
    // Also log to console for development
    if (this.isDevelopmentMode()) {
      this.logToConsole(level, logMessage);
    }
  }

  /**
   * Check if message should be logged based on current log level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    const currentLevelValue = levels[this.logLevel];
    const messageLevelValue = levels[level];
    
    return currentLevelValue !== undefined && 
           messageLevelValue !== undefined && 
           messageLevelValue >= currentLevelValue;
  }

  /**
   * Format additional arguments for logging
   */
  private formatArguments(args: unknown[]): string {
    if (args.length === 0) {
      return '';
    }

    const formatted = args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    return ` ${formatted}`;
  }

  /**
   * Log to console with appropriate method
   */
  private logToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
        break;
    }
  }

  /**
   * Check if running in development mode
   */
  private isDevelopmentMode(): boolean {
    return process.env.NODE_ENV === 'development';
  }
} 