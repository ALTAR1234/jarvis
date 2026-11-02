// J.A.R.V.I.S. plugin template. Copy this file, rename it without the leading underscore
// (files starting with "_" are ignored), then restart J.A.R.V.I.S. or choose "Reload plugins".
//
// A plugin exports one tool (or an array of tools). Gemini decides when to call it from the description.
//   name         snake_case, unique
//   description  what it does and when to use it
//   parameters   JSON-schema-like object ({ type: 'object', properties, required })
//   confirm      true (or (args) => boolean) to ask the user in the HUD before running
//   summary      optional (args) => short text shown in the conversation
//   run          async (args, ctx) => result object (status defaults to "done")
//
// ctx: { powershell(script) -> {code, stdout, stderr}, launch(target), notify(title, body),
//        resolvePath(p), dataDir, remember(fact), emit(type, data) }
module.exports = {
  name: 'example_tool',
  description: 'Describe precisely what this tool does and when J.A.R.V.I.S. should use it.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'Some input' } }, required: ['text'] },
  confirm: false,
  summary: (args) => `Example with ${args.text}`,
  async run(args, ctx) {
    return { echoed: args.text };
  }
};
