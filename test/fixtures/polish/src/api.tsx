/** Matches words separated by one or more spaces. */
export const matches = (input: string) => /a +b/.test(input);

/** Returns the cached value immediately. */
export const value = () => 1;

export const typed: () => number = () => 2;

export const template = (input: string) => `before ${input} after`;

export const view = () => <span>hello world</span>;

export function separated(input: number) {
  return;
  input;
}

export const first = () => 1,
  second = () => 2;

export class Store {
  static read() {
    return 1;
  }
  read() {
    return 2;
  }
  static get size() {
    return 3;
  }
  get size() {
    return 4;
  }
}

export const staticCaller = () => Store.read();
export const instanceCaller = (store: Store) => store.read();

Store.read();
