/* @unit-ready */
import { workspace, window } from 'vscode';
import {
  CREATE_DAILY_NOTE_WARNING_RESPONSE,
  createDailyNoteIfNotExists,
  getDailyNoteUri,
} from './dated-notes';
import { isWindows } from './core/common/platform';
import {
  cleanWorkspace,
  closeEditors,
  createFile,
  deleteFile,
  showInEditor,
  withModifiedFoamConfiguration,
} from './test/test-utils-vscode';
import { fromVsCodeUri } from './utils/vsc-utils';
import { fileExists, readFile } from './services/editor';
import {
  getDailyNoteTemplateCandidateUris,
  getDailyNoteTemplateUri,
} from './services/templates';

describe('getDailyNoteUri', () => {
  const date = new Date('2021-02-07T00:00:00Z');
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const isoDate = `${year}-0${month}-0${day}`;

  test('Adds the root directory to relative directories', async () => {
    const config = 'journal';

    const expectedUri = fromVsCodeUri(
      workspace.workspaceFolders[0].uri
    ).joinPath(config, `${isoDate}.md`);

    await withModifiedFoamConfiguration('openDailyNote.directory', config, () =>
      expect(getDailyNoteUri(date)).toEqual(expectedUri)
    );
  });

  test('Uses absolute directories without modification', async () => {
    const config = isWindows
      ? 'C:\\absolute_path\\journal'
      : '/absolute_path/journal';
    const expectedPath = isWindows
      ? `${config}\\${isoDate}.md`
      : `${config}/${isoDate}.md`;

    await withModifiedFoamConfiguration('openDailyNote.directory', config, () =>
      expect(getDailyNoteUri(date).toFsPath()).toMatch(expectedPath)
    );
  });
});

describe('Daily note creation and template processing', () => {
  const DAILY_NOTE_TEMPLATE = ['.foam', 'templates', 'daily-note.md'];

  beforeEach(async () => {
    // Ensure daily note template are removed before each test
    for (const template of getDailyNoteTemplateCandidateUris()) {
      if (await fileExists(template)) {
        await deleteFile(template);
      }
    }
  });

  describe('Basic daily note creation', () => {
    it('Creates a new daily note when it does not exist', async () => {
      const targetDate = new Date(2021, 8, 1);
      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance

      const result = await createDailyNoteIfNotExists(targetDate, foam);

      expect(result.didCreateFile).toBe(true);
      expect(result.uri).toEqual(uri);

      const doc = await showInEditor(uri);
      expect(doc.editor.document.getText()).toContain('2021-09-01');
    });

    it('Opens existing daily note when it already exists', async () => {
      const targetDate = new Date(2021, 8, 2);
      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance

      // Create the file first
      await createFile('# Existing Note\n\nContent here', [uri.getBasename()]);

      const result = await createDailyNoteIfNotExists(targetDate, foam);

      expect(result.didCreateFile).toBe(false);
      expect(result.uri).toEqual(uri);

      const doc = await showInEditor(uri);
      expect(doc.editor.document.getText()).toContain('Existing Note');
    });
  });

  describe('Template variable resolution', () => {
    it('Resolves all FOAM_DATE_* variables correctly', async () => {
      const targetDate = new Date(2021, 8, 12); // September 12, 2021

      const template = await createFile(
        `# \${FOAM_DATE_YEAR}-\${FOAM_DATE_MONTH}-\${FOAM_DATE_DATE}

Year: \${FOAM_DATE_YEAR} (short: \${FOAM_DATE_YEAR_SHORT})
Month: \${FOAM_DATE_MONTH} (name: \${FOAM_DATE_MONTH_NAME}, short: \${FOAM_DATE_MONTH_NAME_SHORT})
Date: \${FOAM_DATE_DATE}
Day: \${FOAM_DATE_DAY_NAME} (short: \${FOAM_DATE_DAY_NAME_SHORT})
Week: \${FOAM_DATE_WEEK}
Week Year: \${FOAM_DATE_WEEK_YEAR}
Unix: \${FOAM_DATE_SECONDS_UNIX}`,
        DAILY_NOTE_TEMPLATE
      );

      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(result.uri);
      const content = doc.editor.document.getText();

      expect(content).toContain('# 2021-09-12');
      expect(content).toContain('Year: 2021 (short: 21)');
      expect(content).toContain('Month: 09 (name: September, short: Sep)');
      expect(content).toContain('Date: 12');
      expect(content).toContain('Day: Sunday (short: Sun)');
      expect(content).toContain('Week: 36');
      expect(content).toContain('Week Year: 2021');

      await deleteFile(template.uri);
      await deleteFile(result.uri);
    });

    it('Resolves FOAM_TITLE variable for daily notes', async () => {
      const targetDate = new Date(2021, 8, 13);

      const template = await createFile(
        // eslint-disable-next-line no-template-curly-in-string
        '# Daily Note: ${FOAM_TITLE}\n\nToday is ${FOAM_TITLE}.',
        DAILY_NOTE_TEMPLATE
      );

      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(uri);
      const content = doc.editor.document.getText();
      expect(content).toContain('Daily Note: 2021-09-13');
      expect(content).toContain('Today is 2021-09-13.');
      await deleteFile(result.uri);
      await deleteFile(template.uri);
    });
  });

  describe('Configuration settings', () => {
    it('Respects custom filename format', async () => {
      const targetDate = new Date(2021, 8, 14);
      const customFormat = 'yyyy-mm-dd';

      await withModifiedFoamConfiguration(
        'openDailyNote.filenameFormat',
        customFormat,
        async () => {
          const uri = getDailyNoteUri(targetDate);
          expect(uri.getBasename()).toBe('2021-09-14.md');
        }
      );
    });

    it('Respects custom file extension', async () => {
      const targetDate = new Date(2021, 8, 15);

      await withModifiedFoamConfiguration(
        'openDailyNote.fileExtension',
        'txt',
        async () => {
          const uri = getDailyNoteUri(targetDate);
          expect(uri.getBasename()).toBe('2021-09-15.txt');
        }
      );
    });

    it('Respects custom directory setting', async () => {
      const targetDate = new Date(2021, 8, 16);
      const customDir = 'journal/daily';

      await withModifiedFoamConfiguration(
        'openDailyNote.directory',
        customDir,
        async () => {
          const uri = getDailyNoteUri(targetDate);
          expect(uri.path).toContain('/journal/daily/');
        }
      );
    });

    it('Uses custom title format when specified', async () => {
      const targetDate = new Date(2021, 8, 17);

      await withModifiedFoamConfiguration(
        'openDailyNote.titleFormat',
        'fullDate',
        async () => {
          const uri = getDailyNoteUri(targetDate);
          const foam = {} as any; // Mock Foam instance
          const result = await createDailyNoteIfNotExists(targetDate, foam);

          const doc = await showInEditor(uri);
          const content = doc.editor.document.getText();
          expect(content).toContain('# Friday, September 17, 2021');
          await deleteFile(result.uri);
        }
      );
    });
  });

  describe('Template types and processing', () => {
    it('Processes Markdown templates correctly', async () => {
      const targetDate = new Date(2021, 8, 19);

      const template = await createFile(
        // eslint-disable-next-line no-template-curly-in-string
        'hello ${FOAM_DATE_MONTH_NAME} ${FOAM_DATE_DATE} hello',
        DAILY_NOTE_TEMPLATE
      );

      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(uri);
      const content = doc.editor.document.getText();
      expect(content).toEqual('hello September 19 hello');
      await deleteFile(result.uri);
      await deleteFile(template.uri);
    });

    it('Processes JavaScript templates correctly', async () => {
      const targetDate = new Date(2021, 8, 20);

      const jsTemplate = await createFile(
        `async function createNote ({ foamDate }) {
  const monthName = foamDate.toLocaleString('default', { month: 'long' });
  const day = foamDate.getDate();
  return {
    filepath: \`\${foamDate.getFullYear()}-\${String(foamDate.getMonth() + 1).padStart(2, '0')}-\${String(day).padStart(2, '0')}.md\`,
    content: \`# JS Template: \${monthName} \${day}\n\nGenerated by JavaScript template.\`
  };
};`,
        ['.foam', 'templates', 'daily-note.js']
      );

      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(uri);
      const content = doc.editor.document.getText();
      expect(content).toContain('# JS Template: September 20');
      expect(content).toContain('Generated by JavaScript template.');

      await deleteFile(jsTemplate.uri);
      await deleteFile(result.uri);
    });

    it('Falls back to default text when no template exists', async () => {
      const targetDate = new Date(2021, 8, 21);
      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(result.uri);
      const content = doc.editor.document.getText();
      expect(content).toContain('# 2021-09-21'); // Should use fallback text with formatted date
    });

    it('prompts to create a daily note template if one does not exist', async () => {
      const targetDate = new Date(2021, 8, 23);
      const foam = {} as any;

      expect(await getDailyNoteTemplateUri()).not.toBeDefined();

      // Intercept the showWarningMessage call
      const showWarningMessageSpy = jest
        .spyOn(window, 'showWarningMessage')
        .mockResolvedValue(CREATE_DAILY_NOTE_WARNING_RESPONSE as any); // simulate user action

      await createDailyNoteIfNotExists(targetDate, foam);

      expect(showWarningMessageSpy.mock.calls[0][0]).toMatch(
        /No daily note template found/
      );

      const templateUri = await getDailyNoteTemplateUri();

      expect(templateUri).toBeDefined();
      expect(await fileExists(templateUri)).toBe(true);

      const templateContent = await readFile(templateUri);
      expect(templateContent).toContain('foam_template:');

      // Clean up the created template
      await deleteFile(templateUri);
      showWarningMessageSpy.mockRestore();
    });

    it('Processes template frontmatter metadata correctly', async () => {
      const targetDate = new Date(2021, 8, 22);

      const template = await createFile(
        `---
tags: [daily, journal]
author: foam
---
# Daily Note

Content here with \${FOAM_DATE_MONTH_NAME} \${FOAM_DATE_DATE}`,
        DAILY_NOTE_TEMPLATE
      );

      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance
      const result = await createDailyNoteIfNotExists(targetDate, foam);

      const doc = await showInEditor(uri);
      const content = doc.editor.document.getText();

      // Should not contain the frontmatter separator in final content
      expect(content).toContain(`---
tags: [daily, journal]
author: foam
---`);
      expect(content).toContain('# Daily Note');
      expect(content).toContain('Content here with September 22');

      await deleteFile(template.uri);
      await deleteFile(result.uri);
    });
  });

  describe('Issue #1499 - Double template application with absolute paths', () => {
    it('should not apply template twice when reopening existing daily note with absolute filepath template', async () => {
      const targetDate = new Date(2021, 8, 25);
      const TEMPLATE_WITH_ABSOLUTE_FILEPATH = `---
foam_template:
  name: Daily note
  description: Daily note template
  filepath: '/\${FOAM_DATE_YEAR}-\${FOAM_DATE_MONTH}-\${FOAM_DATE_DATE}.md'
---

# \${FOAM_DATE_YEAR}-\${FOAM_DATE_MONTH}-\${FOAM_DATE_DATE} - DAILY NOTE

Daily content here.`;

      // Create the template with absolute filepath
      const template = await createFile(
        TEMPLATE_WITH_ABSOLUTE_FILEPATH,
        DAILY_NOTE_TEMPLATE
      );

      const uri = getDailyNoteUri(targetDate);
      const foam = {} as any; // Mock Foam instance

      // First call: Create the daily note
      const result1 = await createDailyNoteIfNotExists(targetDate, foam);
      expect(result1.didCreateFile).toBe(true);

      const doc1 = await showInEditor(uri);
      const content1 = doc1.editor.document.getText();
      expect(content1).toContain('# 2021-09-25 - DAILY NOTE');
      expect(content1).toContain('Daily content here.');

      // Count how many times the template content appears (should be once)
      const templateOccurrences1 = (
        content1.match(/# 2021-09-25 - DAILY NOTE/g) || []
      ).length;
      expect(templateOccurrences1).toBe(1);

      await closeEditors();

      // Second call: Open existing daily note (this should NOT apply template again)
      const result2 = await createDailyNoteIfNotExists(targetDate, foam);
      expect(result2.didCreateFile).toBe(false); // File already exists

      const doc2 = await showInEditor(uri);
      const content2 = doc2.editor.document.getText();

      // Verify template is NOT applied twice
      const templateOccurrences2 = (
        content2.match(/# 2021-09-25 - DAILY NOTE/g) || []
      ).length;
      expect(templateOccurrences2).toBe(1); // Should still be 1, not 2

      // Content should be identical to first time
      expect(content2).toEqual(content1);

      await deleteFile(template.uri);
      await deleteFile(result1.uri);
    });
  });

  afterAll(async () => {
    await cleanWorkspace();
    await closeEditors();
  });
});
