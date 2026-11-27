import {
  NotionExporter,
  formatRichText,
  getPropertyValue,
  richTextToMarkdown,
} from '../../src/notion-exporter.js';
import { NotionClient } from '../../src/notion.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

class MockNotionClient implements NotionClient {
  searchResults: Record<string, unknown>[] = [];
  blockChildren = new Map<string, Record<string, unknown>[]>();
  databases = new Map<string, Record<string, unknown>>();
  databaseRows = new Map<string, Record<string, unknown>[]>();

  async *searchAll(): AsyncGenerator<Record<string, unknown>, void, unknown> {
    for (const item of this.searchResults) {
      yield item;
    }
  }

  async *queryDatabase(databaseId: string): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const rows = this.databaseRows.get(databaseId) ?? [];
    for (const row of rows) {
      yield row;
    }
  }

  async getBlockChildren(blockId: string): Promise<Record<string, unknown>> {
    return { results: this.blockChildren.get(blockId) ?? [] };
  }

  async getDatabase(databaseId: string): Promise<Record<string, unknown>> {
    return this.databases.get(databaseId) ?? {};
  }
}

describe('NotionExporter', () => {
  let client: MockNotionClient;
  let fs: MockFileSystem;
  let logger: MockLogger;
  let exporter: NotionExporter;

  beforeEach(() => {
    client = new MockNotionClient();
    fs = new MockFileSystem();
    logger = new MockLogger();
    exporter = new NotionExporter(client, fs, logger);
  });

  describe('discoverObjects', () => {
    it('extracts pages and databases', async () => {
      client.searchResults = [
        {
          id: 'page-1',
          object: 'page',
          parent: {},
          properties: {
            title: {
              type: 'title',
              title: [{ plain_text: 'My Page' }],
            },
          },
        },
        {
          id: 'db-1',
          object: 'database',
          parent: {},
          title: [{ plain_text: 'My Database' }],
        },
      ];

      const objects = await exporter.discoverObjects();

      expect(objects).toHaveLength(2);
      expect(objects[0]).toEqual({
        id: 'page-1',
        object: 'page',
        title: 'My Page',
        parentId: null,
      });
      expect(objects[1]).toEqual({
        id: 'db-1',
        object: 'database',
        title: 'My Database',
        parentId: null,
      });
    });
  });

  describe('getParentPath', () => {
    it('builds nested paths', async () => {
      client.searchResults = [
        {
          id: 'parent',
          object: 'page',
          parent: {},
          properties: { title: { type: 'title', title: [{ plain_text: 'Parent' }] } },
        },
        {
          id: 'child',
          object: 'page',
          parent: { page_id: 'parent' },
          properties: { title: { type: 'title', title: [{ plain_text: 'Child' }] } },
        },
        {
          id: 'grandchild',
          object: 'page',
          parent: { page_id: 'child' },
          properties: { title: { type: 'title', title: [{ plain_text: 'Grandchild' }] } },
        },
      ];
      await exporter.discoverObjects();

      expect(exporter.getParentPath('grandchild')).toBe('Parent/Child');
    });

    it('breaks cycles after one traversal', async () => {
      client.searchResults = [
        {
          id: 'a',
          object: 'page',
          parent: { page_id: 'b' },
          properties: { title: { type: 'title', title: [{ plain_text: 'A' }] } },
        },
        {
          id: 'b',
          object: 'page',
          parent: { page_id: 'a' },
          properties: { title: { type: 'title', title: [{ plain_text: 'B' }] } },
        },
      ];
      await exporter.discoverObjects();

      expect(exporter.getParentPath('a')).toBe('A/B');
    });
  });

  describe('exportPage', () => {
    it('writes markdown for a page with blocks', async () => {
      client.blockChildren.set('page-1', [
        {
          id: 'block-1',
          type: 'heading_1',
          has_children: false,
          heading_1: { rich_text: [{ plain_text: 'Hello', annotations: {} }] },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: 'World', annotations: {} }] },
        },
      ]);

      await exporter.exportPage('page-1', 'My Page', '/out/My Page.md');

      const content = fs.files.get('/out/My Page.md');
      expect(content).toContain('# My Page');
      expect(content).toContain('# Hello');
      expect(content).toContain('World');
    });
  });

  describe('exportDatabase', () => {
    it('writes markdown for a database', async () => {
      client.databases.set('db-1', {
        title: [{ plain_text: 'My Database' }],
        description: [],
        properties: { Name: { type: 'title' } },
      });
      client.databaseRows.set('db-1', [
        {
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Entry 1' }] },
          },
        },
      ]);

      await exporter.exportDatabase('db-1', 'My Database', '/out/My Database.md');

      const content = fs.files.get('/out/My Database.md');
      expect(content).toContain('# My Database');
      expect(content).toContain('## Entry 1');
    });
  });

  describe('uniqueFilePath', () => {
    it('appends counters for duplicate paths', async () => {
      await fs.writeFile('/dir/file.md', '');
      await fs.writeFile('/dir/file_1.md', '');

      const path = await exporter.uniqueFilePath('/dir', 'file', '.md');
      expect(path).toBe('/dir/file_2.md');
    });
  });
});

describe('richTextToMarkdown', () => {
  it('applies bold formatting', () => {
    const text = [{ plain_text: 'bold', annotations: { bold: true }, href: null }];
    expect(richTextToMarkdown({ rich_text: text })).toBe('**bold**');
  });

  it('applies link formatting', () => {
    const text = [{ plain_text: 'link', annotations: {}, href: 'https://example.com' }];
    expect(richTextToMarkdown({ rich_text: text })).toBe('[link](https://example.com)');
  });
});

describe('formatRichText', () => {
  it('handles nested annotations', () => {
    const text = {
      plain_text: 'text',
      annotations: { bold: true, italic: true },
      href: null,
    };
    expect(formatRichText(text)).toBe('***text***');
  });
});

describe('getPropertyValue', () => {
  interface Case {
    name: string;
    property: unknown;
    expected: string;
  }

  // One row per Notion property type (and its edge cases): the export
  // fidelity of database rows depends on this switch staying exhaustive.
  const cases: Case[] = [
    {
      name: 'missing properties render empty',
      property: null,
      expected: '',
    },
    {
      name: 'undefined properties render empty',
      property: undefined,
      expected: '',
    },
    {
      name: 'title concatenates plain text',
      property: { type: 'title', title: [{ plain_text: 'My' }, { plain_text: ' Page' }] },
      expected: 'My Page',
    },
    {
      name: 'rich_text concatenates plain text',
      property: { type: 'rich_text', rich_text: [{ plain_text: 'plain' }] },
      expected: 'plain',
    },
    {
      name: 'number renders its value',
      property: { type: 'number', number: 42 },
      expected: '42',
    },
    {
      name: 'a null number renders empty',
      property: { type: 'number', number: null },
      expected: '',
    },
    {
      name: 'select renders its name',
      property: { type: 'select', select: { name: 'In Progress' } },
      expected: 'In Progress',
    },
    {
      name: 'multi_select joins names with semicolons',
      property: {
        type: 'multi_select',
        multi_select: [{ name: 'alpha' }, { name: 'beta' }],
      },
      expected: 'alpha; beta',
    },
    {
      name: 'status renders its name',
      property: { type: 'status', status: { name: 'Done' } },
      expected: 'Done',
    },
    {
      name: 'date renders its start',
      property: { type: 'date', date: { start: '2026-01-01' } },
      expected: '2026-01-01',
    },
    {
      name: 'a date range renders start to end',
      property: { type: 'date', date: { start: '2026-01-01', end: '2026-02-01' } },
      expected: '2026-01-01 to 2026-02-01',
    },
    {
      name: 'a missing date renders empty',
      property: { type: 'date', date: null },
      expected: '',
    },
    {
      name: 'a string formula renders its string',
      property: { type: 'formula', formula: { type: 'string', string: 'Result' } },
      expected: 'Result',
    },
    {
      name: 'a number formula renders its number',
      property: { type: 'formula', formula: { type: 'number', number: 7 } },
      expected: '7',
    },
    {
      name: 'a boolean formula renders its boolean',
      property: { type: 'formula', formula: { type: 'boolean', boolean: true } },
      expected: 'true',
    },
    {
      name: 'a false boolean formula renders false',
      property: { type: 'formula', formula: { type: 'boolean', boolean: false } },
      expected: 'false',
    },
    {
      name: 'a date formula renders the date start',
      property: { type: 'formula', formula: { type: 'date', date: { start: '2026-03-01' } } },
      expected: '2026-03-01',
    },
    {
      name: 'an unknown formula result renders empty',
      property: { type: 'formula', formula: { type: 'unsupported' } },
      expected: '',
    },
    {
      name: 'relation joins ids with semicolons',
      property: { type: 'relation', relation: [{ id: 'id-1' }, { id: 'id-2' }] },
      expected: 'id-1; id-2',
    },
    {
      name: 'rollup renders its nested properties',
      property: {
        type: 'rollup',
        rollup: {
          type: 'array',
          array: [
            { type: 'rich_text', rich_text: [{ plain_text: 'x' }] },
            { type: 'number', number: 3 },
          ],
        },
      },
      expected: 'x; 3',
    },
    {
      name: 'an empty rollup renders empty',
      property: { type: 'rollup', rollup: { type: 'array', array: [] } },
      expected: '',
    },
    {
      name: 'a rollup without an array renders empty',
      property: { type: 'rollup', rollup: { type: 'number', number: 1 } },
      expected: '',
    },
    {
      name: 'people join names with semicolons',
      property: { type: 'people', people: [{ name: 'Ada' }, { name: 'Grace' }] },
      expected: 'Ada; Grace',
    },
    {
      name: 'people without a name fall back to their id',
      property: { type: 'people', people: [{ id: 'person-1' }] },
      expected: 'person-1',
    },
    {
      name: 'files render their names',
      property: { type: 'files', files: [{ name: 'report.pdf' }] },
      expected: 'report.pdf',
    },
    {
      name: 'hosted files fall back to their url',
      property: { type: 'files', files: [{ file: { url: 'https://file.example' } }] },
      expected: 'https://file.example',
    },
    {
      name: 'external files fall back to their url',
      property: { type: 'files', files: [{ external: { url: 'https://external.example' } }] },
      expected: 'https://external.example',
    },
    {
      name: 'checkbox renders true',
      property: { type: 'checkbox', checkbox: true },
      expected: 'true',
    },
    {
      name: 'checkbox renders false',
      property: { type: 'checkbox', checkbox: false },
      expected: 'false',
    },
    {
      name: 'a missing checkbox renders false',
      property: { type: 'checkbox' },
      expected: 'false',
    },
    {
      name: 'url renders its value',
      property: { type: 'url', url: 'https://example.com' },
      expected: 'https://example.com',
    },
    {
      name: 'email renders its value',
      property: { type: 'email', email: 'me@example.com' },
      expected: 'me@example.com',
    },
    {
      name: 'phone_number renders its value',
      property: { type: 'phone_number', phone_number: '+1 555 0100' },
      expected: '+1 555 0100',
    },
    {
      name: 'created_by renders the user name',
      property: { type: 'created_by', created_by: { name: 'Ada', id: 'user-1' } },
      expected: 'Ada',
    },
    {
      name: 'created_by without a name falls back to the id',
      property: { type: 'created_by', created_by: { id: 'user-1' } },
      expected: 'user-1',
    },
    {
      name: 'created_time renders its value',
      property: { type: 'created_time', created_time: '2026-01-01T00:00:00Z' },
      expected: '2026-01-01T00:00:00Z',
    },
    {
      name: 'last_edited_by without a name falls back to the id',
      property: { type: 'last_edited_by', last_edited_by: { id: 'user-2' } },
      expected: 'user-2',
    },
    {
      name: 'last_edited_time renders its value',
      property: { type: 'last_edited_time', last_edited_time: '2026-01-02T00:00:00Z' },
      expected: '2026-01-02T00:00:00Z',
    },
    {
      name: 'an unknown property type falls back to JSON',
      property: { type: 'shorthand', shorthand: {} },
      expected: '{"type":"shorthand","shorthand":{}}',
    },
  ];

  it.each(cases)('$name', ({ property, expected }) => {
    expect(getPropertyValue(property)).toBe(expected);
  });
});
