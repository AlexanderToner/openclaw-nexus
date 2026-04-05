// src/types/jsdom.d.ts
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: object);
    readonly window: Window & typeof globalThis;
  }
}
