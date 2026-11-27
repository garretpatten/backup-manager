import { resetExternalDriveMountCache } from '../../src/export-dir.js';
import { TodoistBackup, TodoistBackupConfig } from '../../src/todoist-backup.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

function page(results: unknown[], nextCursor: string | null = null): string {
  return JSON.stringify({ results, next_cursor: nextCursor });
}

describe('TodoistBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: TodoistBackupConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive(fs);
    resetExternalDriveMountCache();

    context = {
      logger,
      fs,
      http,
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });

    config = {
      apiToken: 'token123',
      homeDir: '/home/user',
      logDir: '/logs',
    };
  });

  it('writes tasks, projects, and labels to disk, zips them, and stores the archive', async () => {
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', content: 'Task 1' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', name: 'Inbox' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', name: 'urgent' }]),
    });

    await new TodoistBackup(context).run(config);

    const exportDir = '/home/user/Todoist-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/tasks.json`)).toBe(
      JSON.stringify([{ id: '1', content: 'Task 1' }], null, 2),
    );
    expect(fs.files.get(`${exportDir}/projects.json`)).toBe(
      JSON.stringify([{ id: '1', name: 'Inbox' }], null, 2),
    );
    expect(fs.files.get(`${exportDir}/labels.json`)).toBe(
      JSON.stringify([{ id: '1', name: 'urgent' }], null, 2),
    );
    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Todoist-Export_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Todoist-Export_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe('/home/user');
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15.zip')).toBeUndefined();
    expect(
      fs.files.get('/home/user/Exports/Exports_2024-06-15/Todoist-Export_2024-06-15.zip'),
    ).toBe('zip-content');
    expect(
      logger.messages.some((m) => m.level === 'INFO' && m.message.includes('EXTERNAL_DRIVE_LABEL')),
    ).toBe(true);
  });

  it('fails the run when the tasks fetch fails instead of writing an empty export', async () => {
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', name: 'Inbox' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: page([]),
    });
    // No response registered for tasks: the fetch fails.

    await expect(new TodoistBackup(context).run(config)).rejects.toThrow(
      'No mock response for GET https://api.todoist.com/api/v1/tasks?limit=200',
    );

    expect(archive.calls).toHaveLength(0);
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15.zip')).toBeUndefined();
  });

  it('fails the run when the projects fetch fails instead of writing an empty export', async () => {
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', content: 'Task 1' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/labels?limit=200', {
      statusCode: 200,
      body: page([]),
    });
    // No response registered for projects: the fetch fails.

    await expect(new TodoistBackup(context).run(config)).rejects.toThrow(
      'No mock response for GET https://api.todoist.com/api/v1/projects?limit=200',
    );

    expect(archive.calls).toHaveLength(0);
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15.zip')).toBeUndefined();
  });

  it('fails the run when the labels fetch fails instead of writing an empty export', async () => {
    http.setResponse('GET', 'https://api.todoist.com/api/v1/tasks?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', content: 'Task 1' }]),
    });
    http.setResponse('GET', 'https://api.todoist.com/api/v1/projects?limit=200', {
      statusCode: 200,
      body: page([{ id: '1', name: 'Inbox' }]),
    });
    // No response registered for labels: the fetch fails.

    await expect(new TodoistBackup(context).run(config)).rejects.toThrow(
      'No mock response for GET https://api.todoist.com/api/v1/labels?limit=200',
    );

    expect(archive.calls).toHaveLength(0);
    expect(fs.files.get('/home/user/Todoist-Export_2024-06-15.zip')).toBeUndefined();
  });
});
