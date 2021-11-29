/**
 * AggregateError aggregates mutliple errors into a single one.
 * @extends Error
 */
export class AggregateError extends Error {
	#errors;

	name = 'AggregateError';

	constructor(errors) {
		if (!Array.isArray(errors)) {
			throw new TypeError(
				`Expected input to be of type Array, got ${typeof errors}`,
			);
		}

		errors = errors.map(error => {
			if (error instanceof Error) {
				return error;
			}

			if (error !== null && typeof error === 'object') {
				// NOTE(joel): Handle plain error objects with a message property
				// and optional other properties as well.
				return Object.assign(new Error(error.message), error);
			}

			return new Error(error);
		});

		let message = errors
			.map(error =>
				typeof error.stack === 'string'
					? cleanInternalStack(error.stack)
					: String(error),
			)
			.join('\n');
		message = '\n' + indentString(message, 4);
		super(message);

		this.#errors = errors;
	}

	errors() {
		// NOTE(joel): Return a copy of our private `#errors` array.
		return this.#errors.slice();
	}
}

////////////////////////////////////////////////////////////////////////////////

/**
 * cleanInternalStack
 * @param {string} stack
 * @returns {string}
 */
function cleanInternalStack(stack) {
	return stack.replace(/\s+at .*aggregate-error\/index.js:\d+:\d+\)?/g, '');
}

////////////////////////////////////////////////////////////////////////////////

/**
 * @typedef {Object} IndentOptions
 * @prop {string} [indent=' ']
 * @prop {boolean} [includeEmptyLines=false]
 */

/**
 * indentString
 * @param {string} string
 * @param {number} [count=1]
 * @param {IndentOptions} [options={}]
 */
export function indentString(string, count = 1, options = {}) {
	const { indent = ' ', includeEmptyLines = false } = options;

	if (count === 0) {
		return string;
	}

	const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;

	return string.replace(regex, indent.repeat(count));
}
