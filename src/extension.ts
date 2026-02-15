/*
 * FocusMark Extension - Main Entry Point
 * 
 * Provides visual indicators for active VS Code windows when working with multiple instances.
 * Uses interaction-based activation (not focus-based) to solve the "Chrome switch" problem.
 * 
 * Design decisions:
 * - Lazy loading for fast startup performance
 * - Clean separation of concerns
 * - Comprehensive error handling with graceful degradation
 * - Event-driven architecture for maintainability
 * 
 * @version 0.1.0
 */

import * as vscode from 'vscode';
import os from 'node:os';
import { Logger } from './utils/Logger';
import { ConfigurationManager } from './config/ConfigurationManager';
import { FocusMarkManager } from './core/FocusMarkManager';
import { WindowIdentifier } from './core/WindowIdentifier';

let focusMarkManager: FocusMarkManager | undefined;
let logger: Logger | undefined;
let configManager: ConfigurationManager | undefined;
const MAC_TIP_ACKNOWLEDGED_KEY = 'focusmark.macTipAcknowledged.v5';
const ALTTAB_URL = 'https://github.com/lwouis/alt-tab-macos';

/**
 * Extension activation lifecycle hook
 * Called when VS Code loads the extension
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    const runtimePlatform = os.platform();

    // Initialize core services
    logger = new Logger('FocusMark');
    WindowIdentifier.setLogger(logger);
    configManager = new ConfigurationManager();
    logger.setLogLevel(configManager.getConfiguration().logLevel);
    setupLogLevelListener();
    
    logger.info('🚀 FocusMark extension starting...');

    focusMarkManager = new FocusMarkManager(
      context,
      configManager,
      logger
    );

    // Register VS Code commands
    registerCommands(context);

    // Initialize main manager when the extension starts enabled
    if (configManager.isEnabled()) {
      await focusMarkManager.initialize();
      logger.info('✅ FocusMark extension activated successfully');
    } else {
      logger.info('🔕 FocusMark is disabled in settings (commands remain available)');
    }

    scheduleMacTipOnFirstInteraction(context, runtimePlatform);
  } catch (error) {
    await handleActivationError(error);
  }
}

/**
 * Extension deactivation lifecycle hook
 * Called when VS Code unloads the extension
 */
export async function deactivate(): Promise<void> {
  try {
    logger?.info('🔄 FocusMark extension deactivating...');
    
    // Clean shutdown of all services with proper async handling
    if (focusMarkManager) {
      await focusMarkManager.dispose();
      focusMarkManager = undefined;
    }
    
    if (configManager) {
      configManager.dispose();
      configManager = undefined;
    }
    
    logger?.info('✅ FocusMark extension deactivated');
    WindowIdentifier.clearLogger();
    logger?.dispose();
    logger = undefined;
  } catch (error) {
    // Log error but don't throw - VS Code is shutting down
    console.error('Error during FocusMark deactivation:', error);
  }
}

/**
 * Register all VS Code commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  if (!focusMarkManager || !configManager || !logger) {
    throw new Error('Services not initialized - cannot register commands');
  }

  const commands = [
    vscode.commands.registerCommand('focusmark.enable', async () => {
      try {
        await focusMarkManager!.enable();
        vscode.window.showInformationMessage('🎨 FocusMark enabled');
        logger!.info('Extension enabled via command');
      } catch (error) {
        logger!.error('Failed to enable extension:', error);
        vscode.window.showErrorMessage('Failed to enable FocusMark');
      }
    }),

    vscode.commands.registerCommand('focusmark.disable', async () => {
      try {
        await focusMarkManager!.disable();
        vscode.window.showInformationMessage('🔕 FocusMark disabled');
        logger!.info('Extension disabled via command');
      } catch (error) {
        logger!.error('Failed to disable extension:', error);
        vscode.window.showErrorMessage('Failed to disable FocusMark');
      }
    }),

    vscode.commands.registerCommand('focusmark.changeTheme', async () => {
      try {
        const themes = [
          { label: '🎨 Auto (Smart Colors)', value: 'auto' },
          { label: '🧡 Orange Burst', value: 'orange' },
          { label: '💙 Ocean Blue', value: 'blue' },
          { label: '💚 Forest Green', value: 'green' },
          { label: '💜 Royal Purple', value: 'purple' },
          { label: '🎛️ Custom Color', value: 'custom' }
        ];

        const selected = await vscode.window.showQuickPick(themes, {
          placeHolder: 'Choose a color theme for your active window',
          matchOnDetail: true
        });

        if (!selected) {
          logger!.info('Theme selection cancelled.');
          return;
        }

        if (selected.value === 'custom') {
          await handleCustomColorInput();
          await focusMarkManager!.applyThemeFromCommand();
        } else {
          await configManager!.setTheme(selected.value);
          vscode.window.showInformationMessage(`🎨 Theme changed to ${selected.label}`);
          await focusMarkManager!.applyThemeFromCommand();
        }
      } catch (error) {
        logger!.error('Failed to change theme:', error);
        vscode.window.showErrorMessage('Failed to change theme');
      }
    }),

    vscode.commands.registerCommand('focusmark.changeTitleIndicator', async () => {
      try {
        await handleTitleIndicatorSelection();
      } catch (error) {
        logger!.error('Failed to change title indicator:', error);
        vscode.window.showErrorMessage('Failed to change title indicator');
      }
    }),

    vscode.commands.registerCommand('focusmark.toggleFromStatusBar', async () => {
      try {
        logger!.info('Status bar click command triggered');
        await focusMarkManager!.handleStatusBarClick();
      } catch (error) {
        logger!.error('Failed to handle status bar action:', error);
        vscode.window.showErrorMessage('Failed to handle status bar action');
      }
    }),

    vscode.commands.registerCommand('focusmark.resetColors', async () => {
      try {
        logger!.info('Reset colors command triggered');
        await focusMarkManager!.resetColors();
        vscode.window.showInformationMessage('🧹 All color customizations reset to default');
        logger!.info('All color customizations reset successfully');
      } catch (error) {
        logger!.error('Failed to reset colors:', error);
        vscode.window.showErrorMessage('Failed to reset colors');
      }
    })
  ];

  // Add all commands to extension context for proper cleanup
  commands.forEach(command => context.subscriptions.push(command));
}

function setupLogLevelListener(): void {
  if (!configManager || !logger) {
    return;
  }

  configManager.onConfigurationChange((keys) => {
    if (keys.includes('logLevel')) {
      const level = configManager?.getConfiguration().logLevel ?? 'info';
      logger?.setLogLevel(level);
    }
  });
}

function scheduleMacTipOnFirstInteraction(
  context: vscode.ExtensionContext,
  runtimePlatform: NodeJS.Platform
): void {
  if (runtimePlatform !== 'darwin' || vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return;
  }

  if (context.globalState.get<boolean>(MAC_TIP_ACKNOWLEDGED_KEY, false)) {
    return;
  }

  let disposed = false;
  let inFlight = false;
  let attempts = 0;
  const subscriptions: vscode.Disposable[] = [];
  const maxAttempts = 4;
  const retryIntervalMs = 10000;
  const retryTimer = setInterval(() => {
    void tryShow();
  }, retryIntervalMs);

  const disposeAll = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearInterval(retryTimer);
    subscriptions.forEach(disposable => disposable.dispose());
  };

  const tryShow = async (): Promise<void> => {
    if (disposed || inFlight) {
      return;
    }
    if (context.globalState.get<boolean>(MAC_TIP_ACKNOWLEDGED_KEY, false)) {
      disposeAll();
      return;
    }
    if (attempts >= maxAttempts) {
      disposeAll();
      return;
    }

    attempts += 1;
    inFlight = true;
    try {
      const wasShown = await maybeShowMacTip(context, runtimePlatform);
      if (wasShown || context.globalState.get<boolean>(MAC_TIP_ACKNOWLEDGED_KEY, false)) {
        disposeAll();
      }
    } finally {
      inFlight = false;
    }
  };

  const trigger = (): void => {
    void tryShow();
  };

  subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => trigger()),
    vscode.window.onDidChangeActiveTextEditor(() => trigger()),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        trigger();
      }
    })
  );

  // First attempt shortly after startup.
  setTimeout(() => trigger(), 3000);
}

async function maybeShowMacTip(
  context: vscode.ExtensionContext,
  runtimePlatform: NodeJS.Platform
): Promise<boolean> {
  if (runtimePlatform !== 'darwin') {
    return false;
  }

  if (vscode.env.uiKind !== vscode.UIKind.Desktop) {
    return false;
  }

  const acknowledged = context.globalState.get<boolean>(MAC_TIP_ACKNOWLEDGED_KEY, false);
  if (acknowledged) {
    return false;
  }

  // Only show when this VS Code window is focused, otherwise it can appear in a background window.
  if (!vscode.window.state.focused) {
    await new Promise<void>((resolve) => {
      const disposable = vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) {
          return;
        }
        disposable.dispose();
        resolve();
      });

      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 20000);
    });
  }

  if (!vscode.window.state.focused) {
    return false;
  }

  // Wait so startup/install notifications settle first.
  await new Promise(resolve => setTimeout(resolve, 2000));

  const openAltTab = 'Open AltTab';
  const dismiss = 'Dismiss';
  const selection = await vscode.window.showInformationMessage(
    'FocusMark works best on macOS with AltTab (for true window switching) and Mission Control/App Exposé (for multi-window overview).',
    openAltTab,
    dismiss
  );

  if (selection === openAltTab) {
    await context.globalState.update(MAC_TIP_ACKNOWLEDGED_KEY, true);
    await vscode.env.openExternal(vscode.Uri.parse(ALTTAB_URL));
    return true;
  }

  if (selection === dismiss) {
    await context.globalState.update(MAC_TIP_ACKNOWLEDGED_KEY, true);
  }

  return true;
}

/**
 * Handle custom color input from user
 */
async function handleCustomColorInput(): Promise<void> {
  if (!configManager) {
    return;
  }

  const customColor = await vscode.window.showInputBox({
    prompt: 'Enter custom color (e.g., #FF6B35)',
    value: configManager.getCustomColor(),
    validateInput: (value: string) => {
      const trimmed = value.trim();
      const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      return hexPattern.test(trimmed) 
        ? null 
        : 'Please enter a valid hex color (e.g., #FF6B35)';
    }
  });
  
  if (customColor) {
    await configManager.setCustomColor(customColor.trim());
    await configManager.setTheme('custom');
    vscode.window.showInformationMessage('🎨 Theme changed to Custom Color');
    logger?.info(`Custom color set to: ${customColor}`);
  }
}

async function handleTitleIndicatorSelection(): Promise<void> {
  if (!configManager) {
    return;
  }

  const indicators = [
    { label: '◉', description: 'Default bullseye', value: '◉' },
    { label: '●', description: 'Solid dot', value: '●' },
    { label: '●●', description: 'Double dot', value: '●●' },
    { label: '*', description: 'Asterisk', value: '*' },
    { label: '>>', description: 'Double chevron', value: '>>' },
    { label: '!!', description: 'Double exclamation', value: '!!' },
    { label: '[*]', description: 'Bracketed star', value: '[*]' },
    { label: '[A]', description: 'Bracketed letter', value: '[A]' },
    { label: '▶', description: 'Play triangle', value: '▶' },
    { label: '◆', description: 'Diamond', value: '◆' },
    { label: '◉', description: 'Bullseye', value: '◉' },
    { label: 'Custom...', description: 'Enter your own symbol', value: '__custom__' }
  ];

  const selected = await vscode.window.showQuickPick(indicators, {
    placeHolder: 'Pick a title indicator for the active window'
  });

  if (!selected) {
    return;
  }

  if (selected.value === '__custom__') {
    const customIndicator = await vscode.window.showInputBox({
      prompt: 'Enter a short indicator (1-4 characters)',
      value: configManager.getConfiguration().title.indicator,
      validateInput: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Please enter at least 1 character';
        }
        if (trimmed.length > 4) {
          return 'Keep it short (1-4 characters)';
        }
        return null;
      }
    });

    if (customIndicator) {
      await configManager.setTitleIndicator(customIndicator.trim());
    }
    return;
  }

  await configManager.setTitleIndicator(selected.value);
}

/**
 * Handle extension activation errors with user-friendly messaging
 */
async function handleActivationError(error: unknown): Promise<void> {
  logger?.error('❌ Failed to activate FocusMark extension:', error);
  
  // Show user-friendly error with option to view logs
  const viewLogs = 'View Logs';
  const selection = await vscode.window.showErrorMessage(
    'FocusMark failed to start. Check the output panel for details.',
    viewLogs
  );

  if (selection === viewLogs) {
    logger?.showOutputChannel();
  }

  // Don't re-throw - let VS Code handle gracefully
}

// Explicit CommonJS exports for VS Code extension compatibility
module.exports = { activate, deactivate }; 
