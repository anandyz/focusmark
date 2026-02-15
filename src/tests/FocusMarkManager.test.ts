import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockInstance = {
  applyTheme: ReturnType<typeof vi.fn>;
  removeTheme: ReturnType<typeof vi.fn>;
  ensureCleanStateOnStartup: ReturnType<typeof vi.fn>;
  resetAllColors: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  isActive: ReturnType<typeof vi.fn>;
  restoreGlobalOriginalCustomizations: ReturnType<typeof vi.fn>;
};

type TitleMock = {
  setActive: ReturnType<typeof vi.fn>;
  setInactive: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type StatusMock = {
  setActive: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const memoryFs = new Map<string, string>();
let windowFocused = true;
let themeMock: MockInstance;
let titleMock: TitleMock;
let statusMock: StatusMock;

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn()
};

const resetMocks = (): void => {
  memoryFs.clear();
  windowFocused = true;
  themeMock = {
    applyTheme: vi.fn(),
    removeTheme: vi.fn(),
    ensureCleanStateOnStartup: vi.fn(),
    resetAllColors: vi.fn(),
    dispose: vi.fn(),
    isActive: vi.fn(() => true),
    restoreGlobalOriginalCustomizations: vi.fn()
  };
  titleMock = {
    setActive: vi.fn(),
    setInactive: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn()
  };
  statusMock = {
    setActive: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  };
};

vi.mock('fs-extra', () => ({
  writeJson: async (file: string, data: unknown) => {
    memoryFs.set(file, JSON.stringify(data));
  },
  rename: async (from: string, to: string) => {
    const value = memoryFs.get(from);
    if (value !== undefined) {
      memoryFs.set(to, value);
      memoryFs.delete(from);
    }
  },
  pathExists: async (file: string) => memoryFs.has(file),
  readFile: async (file: string) => {
    const value = memoryFs.get(file);
    if (value === undefined) {
      throw new Error(`Missing file: ${file}`);
    }
    return value;
  },
  remove: async (file: string) => {
    memoryFs.delete(file);
  },
  ensureDirSync: () => undefined,
  watch: () => ({ close: vi.fn() })
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp'
}));

vi.mock('../core/WindowIdentifier', () => ({
  WindowIdentifier: {
    generateWindowId: () => 'window-1',
    getCurrentWorkspaceId: () => 'workspace-1'
  }
}));

vi.mock('../theming/ThemeManager', () => ({
  ThemeManager: class {
    constructor() {
      return themeMock;
    }
  }
}));

vi.mock('../ui/TitleManager', () => ({
  TitleManager: class {
    constructor() {
      return titleMock;
    }
  }
}));

vi.mock('../ui/StatusBarManager', () => ({
  StatusBarManager: class {
    constructor() {
      return statusMock;
    }
  }
}));

vi.mock('vscode', () => ({
  window: {
    get state() {
      return { focused: windowFocused };
    }
  },
  workspace: {
    onDidChangeConfiguration: () => ({ dispose: () => undefined })
  }
}));

describe('FocusMarkManager coordination', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('writes coordination data when applying theme from command', async () => {
    const { FocusMarkManager } = await import('../core/FocusMarkManager');

    const configManager = {
      isEnabled: () => true,
      getConfiguration: () => ({
        enableColors: true,
        title: { enabled: true, indicator: 'X' },
        keepInactiveWindowColors: false,
        coordinationScope: 'global'
      }),
      onConfigurationChange: () => ({ dispose: () => undefined })
    };

    const context = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalStorageUri: { fsPath: '/tmp' }
    };

    const manager = new FocusMarkManager(
      context as never,
      configManager as never,
      mockLogger as never
    );

    await manager.applyThemeFromCommand();

    const coordinationFile = (manager as { coordinationFile: string }).coordinationFile;
    const raw = memoryFs.get(coordinationFile);
    expect(raw).toBeDefined();
    const data = JSON.parse(raw as string);
    expect(data.activeWindowId).toBe('window-1');
    expect(themeMock.applyTheme).toHaveBeenCalled();
  });

  it('deactivates when another window becomes active', async () => {
    const { FocusMarkManager } = await import('../core/FocusMarkManager');

    const configManager = {
      isEnabled: () => true,
      getConfiguration: () => ({
        enableColors: true,
        title: { enabled: true, indicator: 'X' },
        keepInactiveWindowColors: false,
        coordinationScope: 'global'
      }),
      onConfigurationChange: () => ({ dispose: () => undefined })
    };

    const context = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalStorageUri: { fsPath: '/tmp' }
    };

    const manager = new FocusMarkManager(
      context as never,
      configManager as never,
      mockLogger as never
    );

    const coordinationFile = (manager as { coordinationFile: string }).coordinationFile;
    memoryFs.set(
      coordinationFile,
      JSON.stringify({
        activeWindowId: 'window-2',
        workspaceId: 'workspace-2',
        timestamp: Date.now()
      })
    );

    (manager as { isWindowActive: boolean }).isWindowActive = true;
    windowFocused = false;
    await (manager as { handleCoordinationChange: () => Promise<void> }).handleCoordinationChange();

    expect(statusMock.setActive).toHaveBeenCalledWith(false);
    expect(titleMock.setInactive).toHaveBeenCalled();
    expect(themeMock.removeTheme).toHaveBeenCalled();
  });

  it('ignores coordination updates from the same window', async () => {
    const { FocusMarkManager } = await import('../core/FocusMarkManager');

    const configManager = {
      isEnabled: () => true,
      getConfiguration: () => ({
        enableColors: true,
        title: { enabled: true, indicator: 'X' },
        keepInactiveWindowColors: false,
        coordinationScope: 'global'
      }),
      onConfigurationChange: () => ({ dispose: () => undefined })
    };

    const context = {
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalState: {
        get: () => undefined,
        update: async () => undefined
      },
      globalStorageUri: { fsPath: '/tmp' }
    };

    const manager = new FocusMarkManager(
      context as never,
      configManager as never,
      mockLogger as never
    );

    const coordinationFile = (manager as { coordinationFile: string }).coordinationFile;
    memoryFs.set(
      coordinationFile,
      JSON.stringify({
        activeWindowId: 'window-1',
        workspaceId: 'workspace-1',
        timestamp: Date.now()
      })
    );

    (manager as { isWindowActive: boolean }).isWindowActive = true;
    await (manager as { handleCoordinationChange: () => Promise<void> }).handleCoordinationChange();

    expect(themeMock.removeTheme).not.toHaveBeenCalled();
  });
});
