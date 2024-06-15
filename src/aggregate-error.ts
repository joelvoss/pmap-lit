export type ErrorLike = Error | { message: string } | string;

/**
 * AggregateError aggregates mutliple errors into a single one.
 */
export class AggregateError extends Error {
	_errors: ErrorLike[];
	name = 'AggregateError';

	constructor(errors: ErrorLike[]) {
		if (!Array.isArray(errors)) {
			throw new TypeError(
				`Expected input to be of type Array, got ${typeof errors}`,
			);
		}

		errors = errors.map(error => {
			if (error instanceof Error) return error;

			if (error !== null && typeof error === 'object') {
				// NOTE(joel): Handle plain error objects with a message property
				// and optional other properties as well.
				return Object.assign(new Error(error.message), error);
			}

			return new Error(error);
		});

		let message = errors
			.map(error =>
				error instanceof Error && typeof error.stack === 'string'
					? cleanInternalStack(error.stack)
					: String(error),
			)
			.join('\n');
		message = '\n' + indentString(message, 4);
		super(message);

		this._errors = errors;
	}

	errors() {
		// NOTE(joel): Return a copy of our private `_errors` array.
		return this._errors.slice();
	}
}

////////////////////////////////////////////////////////////////////////////////

/**
 * cleanInternalStack removes the internal stack trace from the error stack.
 */
function cleanInternalStack(stack: string) {
	return stack.replace(/\s+at .*aggregate-error\/index.js:\d+:\d+\)?/g, '');
}

////////////////////////////////////////////////////////////////////////////////

interface IndentOptions {
	indent?: string;
	includeEmptyLines?: boolean;
}

/**
 * indentString indents each line in the input string.
 */
export function indentString(
	string: string,
	count = 1,
	options: IndentOptions = {},
) {
	const { indent = ' ', includeEmptyLines = false } = options;

	if (count === 0) {
		return string;
	}

	const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;

	return string.replace(regex, indent.repeat(count));
}
