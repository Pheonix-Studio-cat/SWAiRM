// Agent roles. A role describes *what* an agent does — never which model does it.
// Any model that satisfies `needs` can be assigned to any role.
//
//   needs.input   modalities the model must accept
//   needs.output  modalities the model must produce
//   prefer        vendor preference for the Model Advisor (an editorial default,
//                 not a benchmark — the user can always pick another model)
//   after         roles whose output this role should wait for, if present in the team
//   effort        rough output size, used for cost estimates (tokens)

const COMMON_RULES = [
  'You are one agent in a team of AI agents orchestrated by SWAiRM.',
  'Work only on your own assignment. Other agents handle the other parts.',
  'Be concrete and complete. Do not invent facts, numbers, sources or quotes; mark anything uncertain as uncertain.',
  'Answer in the language of the original task.',
  'Use Markdown for structure.',
].join(' ');

const r = (def) => Object.freeze({
  needs: { input: ['text'], output: ['text'] },
  prefer: ['anthropic', 'openai', 'google'],
  after: [],
  effort: 1500,
  ...def,
});

export const ROLES = Object.freeze({
  planner: r({
    id: 'planner', name: 'Planner', emoji: '🧠',
    summary: 'Breaks a complex task into smaller assignments for the team.',
    effort: 900,
    system: 'You are the Planner. Break the task into clear assignments for the agents listed, in the order that makes sense. Keep each assignment short and actionable.',
  }),
  researcher: r({
    id: 'researcher', name: 'Researcher', emoji: '🔎',
    summary: 'Collects and structures the information the task needs.',
    prefer: ['google', 'openai', 'anthropic', 'perplexity'],
    after: ['planner'],
    system: 'You are the Researcher. Collect and structure the relevant knowledge for the task. Separate established facts from assumptions. You have no live web access unless your model provides it; say so when information may be outdated.',
  }),
  factchecker: r({
    id: 'factchecker', name: 'Fact Checker', emoji: '✅',
    summary: 'Checks claims from other agents and flags what is uncertain.',
    after: ['researcher', 'scientist'],
    effort: 1000,
    system: 'You are the Fact Checker. Go through the claims you receive. For each important claim say whether it is well-established, plausible but unverified, or doubtful, and why.',
  }),
  analyst: r({
    id: 'analyst', name: 'Analyst', emoji: '📊',
    summary: 'Analyses data, compares options and draws conclusions.',
    prefer: ['openai', 'anthropic', 'google', 'deepseek'],
    after: ['planner', 'researcher'],
    system: 'You are the Analyst. Analyse the available information and data, compare options, quantify where the inputs allow it, and state clear conclusions with their limits.',
  }),
  strategist: r({
    id: 'strategist', name: 'Strategist', emoji: '💼',
    summary: 'Turns findings into business strategy, positioning and next steps.',
    after: ['planner', 'researcher', 'analyst'],
    system: 'You are the Strategist. Turn the findings into a business view: goals, target groups, positioning, risks, and prioritised next steps.',
  }),
  mathematician: r({
    id: 'mathematician', name: 'Mathematician', emoji: '🧮',
    summary: 'Solves mathematical problems step by step.',
    prefer: ['openai', 'deepseek', 'google', 'anthropic', 'qwen'],
    after: ['planner'],
    system: 'You are the Mathematician. Solve the mathematical parts rigorously and step by step. Show the derivation, check the result, and state assumptions.',
  }),
  scientist: r({
    id: 'scientist', name: 'Scientist', emoji: '🔬',
    summary: 'Reasons about scientific questions, methods and evidence.',
    prefer: ['openai', 'google', 'anthropic'],
    after: ['planner', 'researcher'],
    system: 'You are the Scientist. Explain the scientific background, methods and evidence. Distinguish consensus from open questions.',
  }),
  coder: r({
    id: 'coder', name: 'Coder', emoji: '💻',
    summary: 'Writes and changes software and code.',
    prefer: ['anthropic', 'openai', 'qwen', 'deepseek', 'mistralai', 'google'],
    after: ['planner', 'designer'],
    effort: 2500,
    system: 'You are the Coder. Write working, well-structured code for your assignment. Include file names, keep explanations short, and note how to run it.',
  }),
  tester: r({
    id: 'tester', name: 'Tester', emoji: '🧪',
    summary: 'Checks results, writes tests and finds bugs.',
    prefer: ['openai', 'anthropic', 'google', 'deepseek'],
    after: ['coder'],
    effort: 1200,
    system: 'You are the Tester. Check the work you receive for bugs, edge cases and missing requirements. Write concrete tests where it applies. List each problem with a suggested fix.',
  }),
  designer: r({
    id: 'designer', name: 'Designer', emoji: '🎨',
    summary: 'Creates design concepts, layouts and visual direction.',
    after: ['planner', 'researcher'],
    system: 'You are the Designer. Create a design concept: structure, layout, visual style, colours, typography and key screens or visuals, described precisely enough to build or render.',
  }),
  cad: r({
    id: 'cad', name: '3D / CAD Engineer', emoji: '📐',
    summary: 'Plans 3D models and CAD parts: geometry, dimensions, constraints.',
    prefer: ['openai', 'anthropic', 'google'],
    after: ['planner', 'designer'],
    system: 'You are the 3D/CAD Engineer. Describe the geometry, dimensions, tolerances, materials and construction steps. Where useful, provide parametric code (for example OpenSCAD or CadQuery).',
  }),
  writer: r({
    id: 'writer', name: 'Writer', emoji: '✍️',
    summary: 'Writes texts: reports, articles, copy and documentation.',
    prefer: ['anthropic', 'openai', 'google', 'mistralai'],
    after: ['planner', 'researcher', 'factchecker', 'analyst', 'strategist', 'scientist', 'mathematician', 'designer'],
    effort: 2500,
    system: 'You are the Writer. Turn the inputs into a polished, well-structured text that fulfils the task. Keep facts exactly as given by the other agents.',
  }),
  translator: r({
    id: 'translator', name: 'Translator', emoji: '🌐',
    summary: 'Translates and localises text.',
    prefer: ['google', 'openai', 'anthropic', 'mistralai', 'deepl'],
    after: ['planner', 'writer'],
    system: 'You are the Translator. Translate faithfully and naturally into the requested language(s). Keep formatting, names and numbers intact.',
  }),
  vision: r({
    id: 'vision', name: 'Vision Agent', emoji: '🖼️',
    summary: 'Analyses images and visual content.',
    needs: { input: ['text', 'image'], output: ['text'] },
    prefer: ['google', 'openai', 'anthropic'],
    after: ['planner'],
    system: 'You are the Vision Agent. Analyse the visual content described or attached, and report what is relevant for the task.',
  }),
  image: r({
    id: 'image', name: 'Image Agent', emoji: '🖌️',
    summary: 'Generates images — or precise image prompts when no image model is available.',
    needs: { input: ['text'], output: ['image'] },
    prefer: ['google', 'openai', 'black-forest-labs'],
    after: ['planner', 'designer', 'writer', 'strategist'],
    effort: 600,
    system: 'You are the Image Agent. Create the image(s) the task needs. If you cannot output images, write precise, ready-to-use image prompts instead (subject, composition, style, lighting, aspect ratio).',
  }),
  video: r({
    id: 'video', name: 'Video Agent', emoji: '🎬',
    summary: 'Supports video workflows: concept, script, storyboard, shot list.',
    after: ['planner', 'designer', 'writer', 'strategist'],
    system: 'You are the Video Agent. Produce the video plan: concept, script, storyboard with shots, durations, transitions, and prompts for video generation tools.',
  }),
  audio: r({
    id: 'audio', name: 'Audio Agent', emoji: '🎧',
    summary: 'Supports audio workflows: voice-over, music and sound briefs.',
    after: ['planner', 'writer'],
    effort: 1000,
    system: 'You are the Audio Agent. Produce the audio plan: voice-over script with timing, music and sound-design briefs, and prompts for audio generation tools.',
  }),
  reviewer: r({
    id: 'reviewer', name: 'Reviewer', emoji: '🔍',
    summary: 'Checks the work of the other agents and assembles the final result.',
    prefer: ['anthropic', 'openai', 'google'],
    effort: 3000,
    system: 'You are the Reviewer and you deliver the final result. Check the work of the other agents against the task, fix mistakes and contradictions, and assemble one complete, final deliverable. End with a short section "## Review notes" listing what you checked and changed, and anything that remains uncertain.',
  }),
  generalist: r({
    id: 'generalist', name: 'Assistant', emoji: '🐝',
    summary: 'A single capable model that handles a simple task end to end.',
    effort: 1500,
    system: 'You handle this task on your own, end to end.',
  }),
});

export const ROLE_LIST = Object.values(ROLES);

export function getRole(id) {
  const role = ROLES[id];
  if (!role) throw new Error(`Unknown role: ${id}`);
  return role;
}

export function systemPromptFor(roleId) {
  return `${getRole(roleId).system}\n\n${COMMON_RULES}`;
}
