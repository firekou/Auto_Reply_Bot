/**
 * Dedupe state.
 *
 * Review R1 F3:
 *  - the key is `source + messageId`, so two sources can reuse an id without
 *    swallowing each other's messages;
 *  - `seen`, `selected` and `spoken` are three separate sets;
 *  - `spoken` is written when playback actually starts, not when a message is
 *    selected, so a validation or TTS failure does not permanently consume the
 *    message.
 */

import { chatKey, type ChatMessage } from '../types.js';

export interface SyntheticIdOptions {
  windowMs: number;
}

export class Deduper {
  private readonly seenKeys = new Set<string>();
  private readonly selectedKeys = new Set<string>();
  private readonly spokenKeys = new Set<string>();
  private readonly syntheticSeen = new Map<string, number>();

  constructor(private readonly options: SyntheticIdOptions = { windowMs: 8000 }) {}

  /** Returns the messages that are new to this source. */
  admit(messages: readonly ChatMessage[]): ChatMessage[] {
    const fresh: ChatMessage[] = [];
    for (const message of messages) {
      const key = chatKey(message);
      if (message.idStability === 'synthetic') {
        const fingerprint = `${message.source}::${message.author ?? ''}::${message.text.trim()}`;
        const previous = this.syntheticSeen.get(fingerprint);
        if (previous !== undefined && message.receivedAt - previous < this.options.windowMs) {
          continue;
        }
        this.syntheticSeen.set(fingerprint, message.receivedAt);
      } else if (this.seenKeys.has(key)) {
        continue;
      }
      this.seenKeys.add(key);
      fresh.push(message);
    }
    return fresh;
  }

  hasSeen(message: Pick<ChatMessage, 'source' | 'messageId'>): boolean {
    return this.seenKeys.has(chatKey(message));
  }

  markSelected(keys: readonly string[]): void {
    for (const key of keys) this.selectedKeys.add(key);
  }

  isSelected(key: string): boolean {
    return this.selectedKeys.has(key);
  }

  /** Called at real playback start only. */
  markSpoken(keys: readonly string[]): void {
    for (const key of keys) this.spokenKeys.add(key);
  }

  hasSpoken(key: string): boolean {
    return this.spokenKeys.has(key);
  }

  get spokenCount(): number {
    return this.spokenKeys.size;
  }

  get spoken(): ReadonlySet<string> {
    return this.spokenKeys;
  }
}
