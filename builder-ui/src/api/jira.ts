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
  /** Every example found near it, newest last. */
  examples: number[];
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
}

/** Reads the story (a link on the configured Jira site, or its key) and finds its examples. */
export const storyExamples = (link: string) =>
  api<StoryExamples>('/api/jira/story-examples', { method: 'POST', json: { link } });
