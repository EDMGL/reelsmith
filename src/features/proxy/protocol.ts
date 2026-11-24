export type ProxyMessage =
  | { type: 'run'; id: number; blob: Blob; shortSide: number; keyFrameInterval: number }
  | { type: 'cancel'; id: number };

export type ProxyResponse =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; blob: Blob }
  | { type: 'error'; id: number; message: string; aborted: boolean };
