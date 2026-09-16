import type { Graph, SymbolId } from "./symbol.js";

export interface StronglyConnectedComponent {
  readonly members: readonly SymbolId[];
}

/**
 * Partition the call graph with Tarjan's algorithm, sorting visits and members for deterministic output.
 * @param graph Call graph whose symbols and forward edges define the components to compute.
 */
export const stronglyConnectedComponents = (
  graph: Graph,
): readonly StronglyConnectedComponent[] => {
  const adjacent = adjacency(graph);
  const indices = new Map<SymbolId, number>();
  const lowLinks = new Map<SymbolId, number>();
  const stack: SymbolId[] = [];
  const onStack = new Set<SymbolId>();
  const components: StronglyConnectedComponent[] = [];
  let nextIndex = 0;

  const visit = (symbol: SymbolId): void => {
    const index = nextIndex++;
    indices.set(symbol, index);
    lowLinks.set(symbol, index);
    stack.push(symbol);
    onStack.add(symbol);

    for (const callee of adjacent.get(symbol) ?? []) {
      if (!indices.has(callee)) {
        visit(callee);
        lowLinks.set(
          symbol,
          Math.min(
            lowLinks.get(symbol) ?? index,
            lowLinks.get(callee) ?? index,
          ),
        );
      } else if (onStack.has(callee)) {
        lowLinks.set(
          symbol,
          Math.min(lowLinks.get(symbol) ?? index, indices.get(callee) ?? index),
        );
      }
    }

    if (lowLinks.get(symbol) !== indices.get(symbol)) return;
    const members: SymbolId[] = [];
    let member: SymbolId | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      members.push(member);
    } while (member !== symbol);
    components.push({ members: members.sort() });
  };

  for (const symbol of [...graph.symbols].sort()) {
    if (!indices.has(symbol)) visit(symbol);
  }
  return components;
};

/**
 * Order strongly connected components with callees before callers and deterministic keys breaking ready-component ties.
 * @param graph The call graph whose symbols and edges determine the component ordering.
 */
export const reverseTopologicalOrder = (
  graph: Graph,
): readonly StronglyConnectedComponent[] => {
  const components = stronglyConnectedComponents(graph);
  const componentBySymbol = new Map<SymbolId, number>();
  components.forEach((component, index) => {
    for (const symbol of component.members)
      componentBySymbol.set(symbol, index);
  });

  const outgoing = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  for (const edge of graph.forward) {
    const from = componentBySymbol.get(edge.from);
    const to = componentBySymbol.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const targets = outgoing[from];
    if (targets !== undefined && !targets.has(to)) {
      targets.add(to);
      indegrees[to] = (indegrees[to] ?? 0) + 1;
    }
  }

  const ready = components
    .map((_, index) => index)
    .filter((index) => indegrees[index] === 0)
    .sort((left, right) =>
      componentKey(components[left]).localeCompare(
        componentKey(components[right]),
      ),
    );
  const callerFirst: number[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    callerFirst.push(current);
    for (const target of outgoing[current] ?? []) {
      indegrees[target] = (indegrees[target] ?? 0) - 1;
      if (indegrees[target] === 0) {
        ready.push(target);
        ready.sort((left, right) =>
          componentKey(components[left]).localeCompare(
            componentKey(components[right]),
          ),
        );
      }
    }
  }

  return callerFirst
    .reverse()
    .map((index) => components[index])
    .filter(isDefined);
};

/**
 * Group components into stable dependency levels whose members are mutually independent and depend only on lower levels.
 * @param graph The symbol graph whose components are leveled by dependency depth.
 */
export const reverseTopologicalLevels = (
  graph: Graph,
): readonly (readonly StronglyConnectedComponent[])[] => {
  const components = reverseTopologicalOrder(graph);
  const componentBySymbol = new Map<SymbolId, number>();
  components.forEach((component, index) => {
    for (const symbol of component.members)
      componentBySymbol.set(symbol, index);
  });

  const levelByComponent = new Map<number, number>();
  const levels: StronglyConnectedComponent[][] = [];
  components.forEach((component, index) => {
    const dependencies = graph.forward
      .filter((edge) => component.members.includes(edge.from))
      .map((edge) => componentBySymbol.get(edge.to))
      .filter(isDefined)
      .filter((dependency) => dependency !== index);
    const level =
      dependencies.length === 0
        ? 0
        : Math.max(
            ...dependencies.map(
              (dependency) => (levelByComponent.get(dependency) ?? 0) + 1,
            ),
          );
    levelByComponent.set(index, level);
    const values = levels[level];
    if (values === undefined) levels[level] = [component];
    else values.push(component);
  });
  return levels;
};

const adjacency = (
  graph: Graph,
): ReadonlyMap<SymbolId, readonly SymbolId[]> => {
  const result = new Map<SymbolId, SymbolId[]>();
  for (const symbol of graph.symbols) result.set(symbol, []);
  for (const edge of graph.forward) result.get(edge.from)?.push(edge.to);
  return result;
};

const componentKey = (
  component: StronglyConnectedComponent | undefined,
): string => component?.members[0] ?? "";

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
