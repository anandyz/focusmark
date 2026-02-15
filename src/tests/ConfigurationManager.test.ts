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
        return {
          workspaceValue: undefined,
          globalValue: Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
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

describe('ConfigurationManager', () => {
  beforeEach(() => {
    mockState.configBySection.clear();
    mockState.updates.length = 0;
  });

  it('uses defaults for invalid theme and color', async () => {
    const { ConfigurationManager } = await import('../config/ConfigurationManager');
    const manager = new ConfigurationManager();

    setConfigValue('focusmark', 'theme', 'invalid');
    setConfigValue('focusmark', 'customColor', 'not-a-color');
    setConfigValue('focusmark', 'keepInactiveWindowColors', true);

    const config = manager.getConfiguration();
    expect(config.theme).toBe('auto');
    expect(config.customColor).toBe('#FF6B35');
    expect(config.keepInactiveWindowColors).toBe(true);
  });

  it('updates title indicator configuration', async () => {
    const { ConfigurationManager } = await import('../config/ConfigurationManager');
    const manager = new ConfigurationManager();

    await manager.setTitleIndicator('X');

    const update = getLastUpdate('focusmark', 'title.indicator');
    expect(update?.value).toBe('X');
    expect(update?.target).toBe('global');
  });

  it('reads enableColors configuration', async () => {
    const { ConfigurationManager } = await import('../config/ConfigurationManager');
    const manager = new ConfigurationManager();

    setConfigValue('focusmark', 'enableColors', false);

    const config = manager.getConfiguration();
    expect(config.enableColors).toBe(false);
  });
});
