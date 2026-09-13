export const leaf = (value: number): number => value + 1;

export const caller = (value: number): number => {
    return leaf(value) * 2;
};
