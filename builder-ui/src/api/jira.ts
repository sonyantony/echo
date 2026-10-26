import { api } from './client';

/** An example payload found in a Jira story (the server's StoryExamples.Example). */
export interface StoryExample {
  id: number;
  /** Pretty printed JSON. */
  json: string;
  /** "Description", "Comment by Priya Shah, 14 Oct 2026". */
  source: string;
  /** What the text just before it calls it, if it says. */
  role?: 'request' | 'response' | null;
}

/** An operation ECHO guessed from a story: the user checks it before it is added. */
export interface StoryOperation {
  method: string;
  /** As the story writes it, with a sample query; empty when it names none. */
  path: string;
  request?: number | null;
  response?: number | null;
  /** The examples that may belong to it, offered first as choices. */
  examples: number[];
  /** Why the AI engine paired them so; absent for ECHO's own guess. */
  reason?: string | null;
}

export interface StoryExamples {
  key: string;
  summary: string;
  /** The story in Jira. */
  link: string;
  /** How many comments were read. */
  comments: number;
  examples: StoryExample[];
  operations: StoryOperation[];
  /** The AI engine that read the story ("gpt-4.1 at acme.openai.azure.com"); absent when the operations are ECHO's own guess. */
  engine?: string | null;
  /** Things to tell the user, e.g. that the AI engine could not be reached. */
  notes?: string[];
}

/** Reads the story (a link on the configured Jira site, or its key) and finds its examples. */
export const storyExamples = (link: string) =>
  api<StoryExamples>('/api/jira/story-examples', { method: 'POST', json: { link } });
