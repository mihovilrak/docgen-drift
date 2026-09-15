export const publicApi = (value: number): number => {
  return value * 2;
};

export class Service {
  run(value: number): number {
    return publicApi(value);
  }

  private normalize(value: number): number {
    return Math.max(0, value);
  }
}
