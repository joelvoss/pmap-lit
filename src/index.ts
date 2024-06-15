import { AggregateError, type ErrorLike } from './aggregate-error';
export { AggregateError };

////////////////////////////////////////////////////////////////////////////////

type MaybePromise<T> = T | Promise<T>;

type IterableInput<T> = AsyncIterable<T> | Iterable<T>;

type Mapper<T = unknown, R = unknown> = (
	element: T,
	index: number,
) => MaybePromise<R | typeof pMapSkip>;

interface Options {
	concurrency?: number;
	stopOnError?: boolean;
}

////////////////////////////////////////////////////////////////////////////////

export const pMapSkip = Symbol('skip');

////////////////////////////////////////////////////////////////////////////////

export class PMapError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PMapError';
	}
}

////////////////////////////////////////////////////////////////////////////////

/**
 * assertConcurrency checks if the concurrency parameter is valid.
 */
function assertConcurrency(concurrency: number) {
	if (
		(Number.isSafeInteger(concurrency) ||
			concurrency === Number.POSITIVE_INFINITY) &&
		concurrency >= 1
	) {
		return true;
	}
	return false;
}

////////////////////////////////////////////////////////////////////////////////

/**
 * pMap maps each element in the iterable to a new element using the mapper
 * function. The mapper function can return a promise or a value. The returned
 * promise resolves when all promises in the iterable have resolved.
 */
export function pMap<T, R>(
	iterable: IterableInput<T>,
	mapper: Mapper<T, R>,
	options: Options = {},
) {
	const { concurrency = Number.POSITIVE_INFINITY, stopOnError = true } =
		options;

	return new Promise((resolve, _reject) => {
		// NOTE(joel): Assert input parameter
		try {
			const isAsyncIterable = Symbol.asyncIterator in iterable;
			const isIterable = Symbol.iterator in iterable;

			if (!isAsyncIterable && !isIterable) {
				throw new PMapError(
					`Expected 'input' to be an 'Iterable' or 'AsyncIterable', got (${typeof iterable})`,
				);
			}

			if (typeof mapper !== 'function') {
				throw new PMapError('Mapper function is required');
			}

			if (!assertConcurrency(concurrency)) {
				throw new PMapError(
					`Expected 'concurrency' to be an integer from 1 and up or 'Infinity', got \`${concurrency}\` (${typeof concurrency})`,
				);
			}
		} catch (err: unknown) {
			if (err instanceof PMapError) {
				throw err;
			}
			throw new TypeError(
				`Expected 'input' to be an 'Iterable' or 'AsyncIterable', got (${typeof iterable})`,
			);
		}

		const result: (typeof pMapSkip | Awaited<R>)[] = [];
		const errors: ErrorLike[] = [];
		const skippedIndexesMap = new Map();
		let isRejected = false;
		let isResolved = false;
		let isIterableDone = false;
		let resolvingCount = 0;
		let currentIndex = 0;
		const iterator =
			Symbol.asyncIterator in iterable
				? iterable[Symbol.asyncIterator]()
				: iterable[Symbol.iterator]();

		/**
		 * _reject is a helper function to reject the promise.
		 */
		function reject(reason?: unknown) {
			isRejected = true;
			isResolved = true;
			_reject(reason);
		}

		async function next() {
			if (isResolved) return;

			const nextItem = await iterator.next();

			const index = currentIndex;
			currentIndex++;

			// NOTE(joel): `iterator.next()` can be called many times in parallel.
			// This can cause multiple calls to this `next()` function to receive a
			// `nextItem` with `done === true`. The shutdown logic that rejects/
			// resolves must be protected so it runs only one time as the
			// `skippedIndex` logic is non-idempotent.
			if (nextItem.done) {
				isIterableDone = true;

				if (resolvingCount === 0 && !isResolved) {
					if (!stopOnError && errors.length > 0) {
						reject(new AggregateError(errors));
						return;
					}

					isResolved = true;

					if (skippedIndexesMap.size === 0) {
						resolve(result);
						return;
					}

					const pureResult = [];

					// Support multiple `pMapSkip`'s.
					for (const [index, value] of result.entries()) {
						if (skippedIndexesMap.get(index) === pMapSkip) {
							continue;
						}

						pureResult.push(value);
					}

					resolve(pureResult);
				}

				return;
			}

			resolvingCount++;

			// NOTE(joel): Run the actual user promise as a detached promise
			// successively filling our `result` array.
			(async () => {
				try {
					const element = await nextItem.value;

					if (isResolved) return;

					const value = await mapper(element, index);

					// NOTE(joel): Stage skipped indices to be later removed from the
					// result set.
					if (value === pMapSkip) {
						skippedIndexesMap.set(index, value);
					}

					result[index] = value;
					resolvingCount--;

					await next();
				} catch (error) {
					// NOTE(joel): Reject on first error.
					if (stopOnError) {
						reject(error);
					} else {
						errors.push(error as ErrorLike);
						resolvingCount--;

						// NOTE(joel): Since an iterable is likely to continue throwing
						// after it throws once, we cannot really continue regadless of
						// `stopOnError`. If we don't catch here, we will likely end up in
						// an infinite loop of failed iterations.
						try {
							await next();
						} catch (error) {
							reject(error);
						}
					}
				}
			})();
		}

		// NOTE(joel): Create the concurrent runners in a detached (non-awaited)
		// promise. We need this so we can await the `next()` calls
		// to stop creating runners before hitting the concurrency limit
		// if the iterable has already been marked as done.
		//
		// We *must* do this for async iterators otherwise we'll spin up
		// infinite `next()` calls by default and never start the event loop.
		(async () => {
			for (let index = 0; index < concurrency; index++) {
				try {
					await next();
				} catch (error) {
					reject(error);
					break;
				}

				if (isIterableDone || isRejected) break;
			}
		})();
	});
}
