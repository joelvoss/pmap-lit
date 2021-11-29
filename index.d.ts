export interface Options {
	readonly concurrency?: number;
	readonly stopOnError?: boolean;
}

export type Mapper<Element = any, NewElement = unknown> = (
	element: Element,
	index: number,
) => NewElement | Promise<NewElement>;

export default function pMap<Element, NewElement>(
	input:
		| AsyncIterable<Element | Promise<Element>>
		| Iterable<Element | Promise<Element>>,
	mapper: Mapper<Element, NewElement>,
	options?: Options,
): Promise<Array<Exclude<NewElement, typeof pMapSkip>>>;

export const pMapSkip: unique symbol;
