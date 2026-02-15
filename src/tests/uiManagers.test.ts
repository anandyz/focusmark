import { beforeEach, describe, expect, it, vi } from 'vitest';

type UpdateEntry = {
  section: string;
  key: string;
  value: unknown;
  target: unknown;
};

const mockState = {
  configBySection: new Map<string, Record<string, unknown>>(),
  updates: [] as UpdateEntry[],
  workspaceFolders: undefined as unknown,
  workspaceFile: undefined as unknown,
  activeTextEditor: undefined as unknown
};

const getSection = (section: string): Record<string, unknown> => {
  const existing = mockState.configBySection.get(section);
  if (existing) {
    return existing;
  }
  const next: Record<string, unknown> = {};
  mockState.configBySection.set(section, next);
  return next;
};

const setConfigValue = (section: string, key: string, value: unknown): void => {
  const values = getSection(section);
  values[key] = value;
};

const getLastUpdate = (section: string, key: string): UpdateEntry | undefined => {
  for (let i = mockState.updates.length - 1; i >= 0; i -= 1) {
    const entry = mockState.updates[i];
    if (entry.section === section && entry.key === key) {
      return entry;
    }
  }
  return undefined;
};

const flushPromises = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
};

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 'global',
    Workspace: 'workspace'
  },
  workspace: {
    get workspaceFolders() {
      return mockState.workspaceFolders;
    },
    get workspaceFile() {
      return mockState.workspaceFile;
    },
    getConfiguration: (section: string) => ({
      get: (key: string, defaultValue?: unknown) => {
        const values = getSection(section);
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue;
      },
      inspect: (key: string) => {
        const values = getSection(section);
        if (!Object.prototype.hasOwnProperty.call(values, key)) {
          return {
            key,
            globalValue: undefined,
            workspaceValue: undefined,
            workspaceFolderValue: undefined
          };
        }
        return {
          key,
          globalValue: values[key],
          workspaceValue: undefined,
          workspaceFolderValue: undefined
        };
      },
      update: (key: string, value: unknown, target: unknown) => {
        const values = getSection(section);
        values[key] = value;
        mockState.updates.push({ section, key, value, target });
        return Promise.resolve();
      }
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined })
  },
  window: {
    get activeTextEditor() {
      return mockState.activeTextEditor;
    }
  }
}));

describe('ThemeManager and TitleManager', () => {
  beforeEach(() => {
    mockState.configBySection.clear();
    mockState.updates.length = 0;
    mockState.workspaceFolders = undefined;
    mockState.workspaceFile = undefined;
    mockState.activeTextEditor = undefined;
  });

  it('applies minimal palette with global target when no workspace', async () => {
    const { ThemeManager } = await import('../theming/ThemeManager');

    const workspaceState = {
      get: () => undefined,
      update: async () => undefined
    };
    const globalState = {
      get: () => undefined,
      update: async () => undefined
    };

    const configManager = {
      getEffectiveColor: () => '#336699',
      getConfiguration: () => ({ fullColorMode: false })
    };

    const logger = {
      info: vi.fn(),
      debug: vi.fn()
    };

    const themeManager = new ThemeManager(
      workspaceState as never,
      globalState as never,
      configManager as never,
      logger as never
    );

    await themeManager.applyTheme();

    const update = getLastUpdate('workbench', 'colorCustomizations');
    const colors = update?.value as Record<string, string>;
    expect(update?.target).toBe('global');
    expect(colors['titleBar.activeBackground']).toBeDefined();
    expect(colors['statusBar.background']).toBeUndefined();
  });

  it('updates window title in global settings when no workspace', async () => {
    const { TitleManager } = await import('../ui/TitleManager');

    mockState.activeTextEditor = {
      document: { fileName: 'file.ts' }
    };

    const logger = {
      debug: vi.fn()
    };

    const titleManager = new TitleManager(logger as never);
    titleManager.setActive('X');
    await flushPromises();

    const update = getLastUpdate('window', 'title');
    expect(update?.target).toBe('global');
  });

  it('preserves user color changes made while FocusMark is applied', async () => {
    const { ThemeManager } = await import('../theming/ThemeManager');

    const state = new Map<string, unknown>();
    const workspaceState = {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          state.delete(key);
        } else {
          state.set(key, value);
        }
      }
    };
    const globalState = {
      get: () => undefined,
      update: async () => undefined
    };

    const configManager = {
      getEffectiveColor: () => '#336699',
      getConfiguration: () => ({ fullColorMode: true })
    };

    const logger = {
      info: vi.fn(),
      debug: vi.fn()
    };

    const themeManager = new ThemeManager(
      workspaceState as never,
      globalState as never,
      configManager as never,
      logger as never
    );

    await themeManager.applyTheme();

    const applied = getLastUpdate('workbench', 'colorCustomizations')?.value as Record<string, string>;
    const userCustomizations = {
      ...applied,
      'titleBar.activeBackground': '#123456'
    };
    setConfigValue('workbench', 'colorCustomizations', userCustomizations);

    await themeManager.removeTheme();

    const restored = getLastUpdate('workbench', 'colorCustomizations')?.value as Record<string, string>;
    expect(restored['titleBar.activeBackground']).toBe('#123456');
  });

  it('restores updated window title when user changes it while active', async () => {
    const { TitleManager } = await import('../ui/TitleManager');

    setConfigValue('window', 'title', 'Default Title');

    const logger = {
      debug: vi.fn()
    };

    const titleManager = new TitleManager(logger as never);
    titleManager.setActive('X');
    await flushPromises();

    setConfigValue('window', 'title', 'User Title');

    titleManager.setInactive();
    await flushPromises();

    titleManager.reset();
    await flushPromises();

    const update = getLastUpdate('window', 'title');
    expect(update?.value).toBe('User Title');
  });
});
