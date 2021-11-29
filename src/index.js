import { AggregateError } from './aggregate-error';
export { AggregateError };

////////////////////////////////////////////////////////////////////////////////

export const pMapSkip = Symbol('skip');

////////////////////////////////////////////////////////////////////////////////

/**
 * @typedef {(
 *   element: Element,
 *   index: number
 * ) => NewElement | Promise<NewElement>} Mapper
 * @template {any} Element
 * @template {unknown} NewElement
 */

/**
 * @typedef {Object} Options
 * @prop {number} concurrency
 * @prop {boolean} stopOnError
 */

/**
 * pMap returns a Promise that is fulfilled when all promises in input and ones
 * returned from mapper are fulfilled, or rejects if any of the promises reject.
 * The fulfilled value is an Array of the fulfilled values returned from mapper
 * in input order.
 * @param {Iterable<Element>} iterable
 * @param {Mapper<Element, NewElement>} mapper
 * @param {Options} [options={}]
 * @returns {Promise<Array<Exclude<NewElement, typeof pMapSkip>>>}
 * @template Element
 * @template NewElement
 */
export async function pMap(iterable, mapper, options = {}) {
	const { concurrency = Number.POSITIVE_INFINITY, stopOnError = true } =
		options;

	return new Promise((resolve, reject) => {
		if (
			iterable[Symbol.iterator] === undefined &&
			iterable[Symbol.asyncIterator] === undefined
		) {
			throw new TypeError(
				`Expected \`input\` to be either an \`Iterable\` or \`AsyncIterable\`, got (${typeof iterable})`,
			);
		}

		if (typeof mapper !== 'function') {
			throw new TypeError('Mapper function is required');
		}

		if (
			!(
				(Number.isSafeInteger(concurrency) ||
					concurrency === Number.POSITIVE_INFINITY) &&
				concurrency >= 1
			)
		) {
			throw new TypeError(
				`Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\` (${typeof concurrency})`,
			);
		}

		const result = [];
		const errors = [];
		const skippedIndexesMap = new Map();
		let isRejected = false;
		let isResolved = false;
		let isIterableDone = false;
		let resolvingCount = 0;
		let currentIndex = 0;
		const iterator =
			iterable[Symbol.iterator] === undefined
				? iterable[Symbol.asyncIterator]()
				: iterable[Symbol.iterator]();

		/**
		 * _reject
		 * @param {string} reason
		 */
		const _reject = reason => {
			isRejected = true;
			isResolved = true;
			reject(reason);
		};

		/**
		 * next processes the next iterable.
		 * @returns {Promise<>}
		 */
		const next = async () => {
			if (isResolved) return;

			const nextItem = await iterator.next();

			const index = currentIndex;
			currentIndex++;

			// NOTE(joel): `iterator.next()` can be called many times in parallel.
			// This can cause multiple calls to this `next()` function to
			// receive a `nextItem` with `done === true`.
			// The shutdown logic that rejects/resolves must be protected
			// so it runs only one time as the `skippedIndex` logic is
			// non-idempotent.
			if (nextItem.done) {
				isIterableDone = true;

				if (resolvingCount === 0 && !isResolved) {
					if (!stopOnError && errors.length > 0) {
						_reject(new AggregateError(errors));
						return;
					}

					isResolved = true;

					if (!skippedIndexesMap.size) {
						resolve(result);
						return;
					}

					const pureResult = [];

					// NOTE(joel): Support multiple `pMapSkip`'s.
					for (const [index, value] of result.entries()) {
						if (skippedIndexesMap.get(index) === pMapSkip) continue;
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
					if (isResolved) return;
					const element = await nextItem.value;

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
						_reject(error);
						return;
					}

					errors.push(error);
					resolvingCount--;

					// NOTE(joel): Since an iterable is likely to continue throwing after
					// it throws once, we cannot really continue regadless of
					// `stopOnError`. If we don't catch here, we will likely end up in
					// an infinite loop of failed iterations.
					try {
						await next();
					} catch (error) {
						_reject(error);
					}
				}
			})();
		};

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
					_reject(error);
					break;
				}

				if (isIterableDone || isRejected) break;
			}
		})();
	});
}
