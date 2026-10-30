export interface YLikeNode {
  toDelta?: () => Array<{ insert?: unknown }>;
  toArray?: () => YLikeNode[];
}

export interface ProseMirrorLikeNode {
  isText?: boolean;
  text?: string;
  content?: { size: number };
  textBetween?: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
}

export function plainTextOfYNode(node: YLikeNode | null | undefined): string;
export function plainTextOfProseMirrorNode(node: ProseMirrorLikeNode | null | undefined): string;
export function normalizeText(text: unknown): string;
export function fingerprintText(text: unknown): string;
export function fingerprintOfYNode(node: YLikeNode | null | undefined): string;
export const FINGERPRINT_RE: RegExp;
