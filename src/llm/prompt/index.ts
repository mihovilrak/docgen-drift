import { GENERATION_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./v1.js";

export const PROMPT_VERSION = `${GENERATION_PROMPT_VERSION}:${JUDGE_PROMPT_VERSION}`;

export {
  GENERATION_PROMPT_VERSION,
  generationPrompt,
  generationSystemPrompt,
  judgePrompt,
  judgeSystemPrompt,
} from "./v1.js";

export { JUDGE_PROMPT_VERSION };
