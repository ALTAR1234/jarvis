// Example plugin: quick notes kept in "J.A.R.V.I.S. Notes.md" in your Documents folder.
const fs = require('node:fs');
const path = require('node:path');
const notesFile = (ctx) => path.join(ctx.resolvePath('Documents'), 'J.A.R.V.I.S. Notes.md');

module.exports = [
  {
    name: 'add_note',
    description: 'Jot down a quick note or idea for the user in their J.A.R.V.I.S. notes file.',
    parameters: { type: 'object', properties: { note: { type: 'string', description: 'The note text' } }, required: ['note'] },
    summary: (a) => `Note: ${a.note}`,
    async run({ note }, ctx) {
      const file = notesFile(ctx);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `- ${new Date().toLocaleString()} — ${String(note).trim()}\n`);
      return { saved: true, file };
    }
  },
  {
    name: 'read_notes',
    description: "Read back the user's recent quick notes.",
    parameters: { type: 'object', properties: {} },
    summary: () => 'Read notes',
    async run(_args, ctx) {
      const file = notesFile(ctx);
      if (!fs.existsSync(file)) return { notes: [], detail: 'No notes yet.' };
      return { notes: fs.readFileSync(file, 'utf8').trim().split('\n').slice(-25) };
    }
  }
];
