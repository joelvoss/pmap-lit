function delay(ms) {
	return new Promise(r => setTimeout(r, ms));
}

function inRange(num, { start = 0, end }) {
	const min = (left, right) => (left < right ? left : right);
	const max = (left, right) => (left > right ? left : right);
	return num >= min(start, end) && num <= max(end, start);
}

function timeSpan() {
	const start = process.hrtime();
	const end = () => {
		const hrtime = process.hrtime(start);
		const nanoseconds = hrtime[0] * 1e9 + hrtime[1];
		return nanoseconds / 1e6; // ms
	};
	return () => end();
}

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

////////////////////////////////////////////////////////////////////////////////

const sharedInput = [
	[async () => 10, 300],
	[20, 200],
	[30, 100],
];

const errorInput1 = [
	[20, 200],
	[30, 100],
	[
		async () => {
			throw new Error('foo');
		},
		10,
	],
	[
		() => {
			throw new Error('bar');
		},
		10,
	],
];

const errorInput2 = [
	[20, 200],
	[
		async () => {
			throw new Error('bar');
		},
		10,
	],
	[30, 100],
	[
		() => {
			throw new Error('foo');
		},
		10,
	],
];

const mapper = async ([value, ms]) => {
	await delay(ms);

	if (typeof value === 'function') {
		value = await value();
	}

	return value;
};

class ThrowingIterator {
	constructor(max, throwOnIndex) {
		this._max = max;
		this._throwOnIndex = throwOnIndex;
		this.index = 0;
		this[Symbol.iterator] = this[Symbol.iterator].bind(this);
	}

	[Symbol.iterator]() {
		let index = 0;
		const max = this._max;
		const throwOnIndex = this._throwOnIndex;
		return {
			next: (() => {
				try {
					if (index === throwOnIndex) {
						throw new Error(`throwing on index ${index}`);
					}

					const item = { value: index, done: index === max };
					return item;
				} finally {
					index++;
					this.index = index;
				}
			}).bind(this),
		};
	}
}

////////////////////////////////////////////////////////////////////////////////

describe(`pMap`, () => {
	const { pMap, AggregateError, pMapSkip } = require('../src/index');

	test('base', async () => {
		const end = timeSpan();

		const res = await pMap(sharedInput, mapper);
		expect(res).toEqual([10, 20, 30]);

		expect(inRange(end(), { start: 290, end: 430 })).toBe(true);
	});

	test('concurrency: 1', async () => {
		const end = timeSpan();

		const res = await pMap(sharedInput, mapper, { concurrency: 1 });
		expect(res).toEqual([10, 20, 30]);

		expect(inRange(end(), { start: 590, end: 760 })).toBe(true);
	});

	test('concurrency: 4', async () => {
		const concurrency = 4;
		const input = Array.from({ length: 100 }).fill(0);

		let running = 0;
		const mapper = async () => {
			running++;
			expect(running <= concurrency).toBe(true);
			await delay(randomInt(30, 200));
			running--;
		};

		await pMap(input, mapper, { concurrency });
	});

	test('handles empty iterable', async () => {
		const res = await pMap([], mapper);
		expect(res).toEqual([]);
	});

	test('async with concurrency: 2 (random time sequence)', async () => {
		const input = Array.from({ length: 10 }).map(() => randomInt(0, 100));
		const mapper = async value => {
			await delay(value);
			return value;
		};

		const result = await pMap(input, mapper, { concurrency: 2 });
		expect(result).toEqual(input);
	});

	test('async with concurrency: 2 (problematic time sequence)', async () => {
		const input = [100, 200, 10, 36, 13, 45];
		const mapper = async value => {
			await delay(value);
			return value;
		};

		const result = await pMap(input, mapper, { concurrency: 2 });
		expect(result).toEqual(input);
	});

	test('async with concurrency: 2 (out of order time sequence)', async () => {
		const input = [200, 100, 50];
		const mapper = async value => {
			await delay(value);
			return value;
		};

		const result = await pMap(input, mapper, { concurrency: 2 });
		expect(result).toEqual(input);
	});

	test('enforce number in options.concurrency', async () => {
		expect.assertions(5);

		try {
			await pMap([], () => {}, { concurrency: 0 });
		} catch (err) {
			expect(err instanceof TypeError).toBe(true);
		}

		try {
			await pMap([], () => {}, { concurrency: 1.5 });
		} catch (err) {
			expect(err instanceof TypeError).toBe(true);
		}

		let res = await pMap([], () => {}, { concurrency: 1 });
		expect(res).toBeTruthy();

		res = await pMap([], () => {}, { concurrency: 10 });
		expect(res).toBeTruthy();

		res = await pMap([], () => {}, { concurrency: Number.POSITIVE_INFINITY });
		expect(res).toBeTruthy();
	});

	test('immediately rejects when stopOnError is true', async () => {
		try {
			await pMap(errorInput1, mapper, { concurrency: 1 });
		} catch (err) {
			expect(err instanceof Error).toBe(true);
			expect(err.message).toBe('foo');
		}

		try {
			await pMap(errorInput2, mapper, { concurrency: 1 });
		} catch (err) {
			expect(err instanceof Error).toBe(true);
			expect(err.message).toBe('bar');
		}
	});

	test('aggregate errors when stopOnError is false', async () => {
		const res = await pMap(sharedInput, mapper, {
			concurrency: 1,
			stopOnError: false,
		});
		expect(res).toEqual([10, 20, 30]);

		try {
			await pMap(errorInput1, mapper, { concurrency: 1, stopOnError: false });
		} catch (err) {
			expect(err instanceof AggregateError).toBe(true);
			expect(err.message).toMatch(/foo(.|\n)*bar/);
		}

		try {
			await pMap(errorInput2, mapper, { concurrency: 1, stopOnError: false });
		} catch (err) {
			expect(err instanceof AggregateError).toBe(true);
			expect(err.message).toMatch(/bar(.|\n)*foo/);
		}
	});

	test('all mappers should run when concurrency is infinite, even after stop-on-error happened', async () => {
		const input = [
			1,
			async () => {
				await delay(300);
				return 2;
			},
			3,
		];

		const mappedValues = [];
		try {
			await pMap(input, async value => {
				value = typeof value === 'function' ? await value() : value;
				mappedValues.push(value);
				if (value === 1) {
					await delay(100);
					throw new Error('Boom!');
				}
			});
		} catch (err) {
			expect(err instanceof Error).toBe(true);
			expect(err.message).toBe('Boom!');
		}

		await delay(500);

		expect(mappedValues).toEqual([1, 3, 2]);
	});

	test('pMapSkip - base', async () => {
		const res = await pMap([1, pMapSkip, 2], async value => value);
		expect(res).toEqual([1, 2]);
	});

	test('pMapSkip - multiple', async () => {
		const res = await pMap(
			[1, pMapSkip, 2, pMapSkip, 3, pMapSkip, pMapSkip, 4],
			async value => value,
		);
		expect(res).toEqual([1, 2, 3, 4]);
	});

	test('pMapSkip - all', async () => {
		const res = await pMap(
			[pMapSkip, pMapSkip, pMapSkip, pMapSkip],
			async value => value,
		);
		expect(res).toEqual([]);
	});

	//////////////////////////////////////////////////////////////////////////////

	describe('AsyncIterator', () => {
		class AsyncTestData {
			constructor(data) {
				this.data = data;
			}

			async *[Symbol.asyncIterator]() {
				for (let index = 0; index < this.data.length; index++) {
					await delay(10);
					yield this.data[index];
				}
			}
		}

		test('main', async () => {
			const end = timeSpan();

			const res = await pMap(new AsyncTestData(sharedInput), mapper);

			expect(res).toEqual([10, 20, 30]);
			expect(inRange(end(), { start: 290, end: 430 })).toBe(true);
		});

		test('concurrency: 1', async () => {
			const end = timeSpan();

			const res = await pMap(new AsyncTestData(sharedInput), mapper, {
				concurrency: 1,
			});

			expect(res).toEqual([10, 20, 30]);
			expect(inRange(end(), { start: 590, end: 760 })).toBe(true);
		});

		test('concurrency: 4', async () => {
			const concurrency = 4;
			const input = Array.from({ length: 100 }).fill(0);

			let running = 0;
			const mapper = async () => {
				running++;
				expect(running <= concurrency).toBe(true);
				await delay(randomInt(30, 200));
				running--;
			};

			await pMap(new AsyncTestData(input), mapper, { concurrency });
		});

		test('handles empty iterable', async () => {
			const res = await pMap(new AsyncTestData([]), mapper);
			expect(res).toEqual([]);
		});

		test('async with concurrency: 2 (random time sequence)', async () => {
			const input = Array.from({ length: 10 }).map(() => randomInt(0, 100));
			const mapper = async value => {
				await delay(value);
				return value;
			};

			const result = await pMap(new AsyncTestData(input), mapper, {
				concurrency: 2,
			});
			expect(result).toEqual(input);
		});

		test('async with concurrency: 2 (problematic time sequence)', async () => {
			const input = [100, 200, 10, 36, 13, 45];
			const mapper = async value => {
				await delay(value);
				return value;
			};

			const result = await pMap(new AsyncTestData(input), mapper, {
				concurrency: 2,
			});
			expect(result).toEqual(input);
		});

		test('async with concurrency: 2 (out of order time sequence)', async () => {
			const input = [200, 100, 50];
			const mapper = async value => {
				await delay(value);
				return value;
			};

			const result = await pMap(new AsyncTestData(input), mapper, {
				concurrency: 2,
			});
			expect(result).toEqual(input);
		});

		test('enforce number in options.concurrency', async () => {
			expect.assertions(5);

			try {
				await pMap(new AsyncTestData([]), () => {}, { concurrency: 0 });
			} catch (err) {
				expect(err instanceof TypeError).toBe(true);
			}

			try {
				await pMap(new AsyncTestData([]), () => {}, { concurrency: 1.5 });
			} catch (err) {
				expect(err instanceof TypeError).toBe(true);
			}

			let res = await pMap(new AsyncTestData([]), () => {}, { concurrency: 1 });
			expect(res).toBeTruthy();

			res = await pMap(new AsyncTestData([]), () => {}, { concurrency: 10 });
			expect(res).toBeTruthy();

			res = await pMap(new AsyncTestData([]), () => {}, {
				concurrency: Number.POSITIVE_INFINITY,
			});
			expect(res).toBeTruthy();
		});

		test('immediately rejects when stopOnError is true', async () => {
			try {
				await pMap(new AsyncTestData(errorInput1), mapper, { concurrency: 1 });
			} catch (err) {
				expect(err instanceof Error).toBe(true);
				expect(err.message).toBe('foo');
			}

			try {
				await pMap(new AsyncTestData(errorInput2), mapper, { concurrency: 1 });
			} catch (err) {
				expect(err instanceof Error).toBe(true);
				expect(err.message).toBe('bar');
			}
		});

		test('aggregate errors when stopOnError is false', async () => {
			const res = await pMap(sharedInput, mapper, {
				concurrency: 1,
				stopOnError: false,
			});
			expect(res).toEqual([10, 20, 30]);

			try {
				await pMap(new AsyncTestData(errorInput1), mapper, {
					concurrency: 1,
					stopOnError: false,
				});
			} catch (err) {
				expect(err instanceof AggregateError).toBe(true);
				expect(err.message).toMatch(/foo(.|\n)*bar/);
			}

			try {
				await pMap(new AsyncTestData(errorInput2), mapper, {
					concurrency: 1,
					stopOnError: false,
				});
			} catch (err) {
				expect(err instanceof AggregateError).toBe(true);
				expect(err.message).toMatch(/bar(.|\n)*foo/);
			}
		});

		test('all mappers should run when concurrency is infinite, even after stop-on-error happened', async () => {
			const input = [
				1,
				async () => {
					await delay(300);
					return 2;
				},
				3,
			];

			const mappedValues = [];
			try {
				await pMap(new AsyncTestData(input), async value => {
					value = typeof value === 'function' ? await value() : value;
					mappedValues.push(value);
					if (value === 1) {
						await delay(100);
						throw new Error('Boom!');
					}
				});
			} catch (err) {
				expect(err instanceof Error).toBe(true);
				expect(err.message).toBe('Boom!');
			}

			await delay(500);

			expect(mappedValues).toEqual([1, 3, 2]);
		});

		test('pMapSkip - base', async () => {
			const res = await pMap(
				new AsyncTestData([1, pMapSkip, 2]),
				async value => value,
			);
			expect(res).toEqual([1, 2]);
		});

		test('pMapSkip - multiple', async () => {
			const res = await pMap(
				new AsyncTestData([1, pMapSkip, 2, pMapSkip, 3, pMapSkip, pMapSkip, 4]),
				async value => value,
			);
			expect(res).toEqual([1, 2, 3, 4]);
		});

		test('pMapSkip - all', async () => {
			const res = await pMap(
				new AsyncTestData([pMapSkip, pMapSkip, pMapSkip, pMapSkip]),
				async value => value,
			);
			expect(res).toEqual([]);
		});

		test('get the correct exception after stop-on-error', async () => {
			const input = [
				1,
				async () => {
					await delay(200);
					return 2;
				},
				async () => {
					await delay(300);
					return 3;
				},
			];
			const mappedValues = [];

			try {
				await pMap(new AsyncTestData(input), async value => {
					if (typeof value === 'function') {
						value = await value();
					}

					mappedValues.push(value);
					// NOTE(joel): Throw for each item - all should fail and we should
					// get only the first.
					await delay(100);
					throw new Error(`Oops! ${value}`);
				});
			} catch (err) {
				expect(err.message).toBe('Oops! 1');
			}
			await delay(500);
			expect(mappedValues).toEqual([1, 2, 3]);
		});
	});

	test('catches exception from source iterator - 1st item', async () => {
		const input = new ThrowingIterator(100, 0);
		const mappedValues = [];
		try {
			await pMap(
				input,
				async value => {
					mappedValues.push(value);
					await delay(100);
					return value;
				},
				{ concurrency: 1, stopOnError: true },
			);
		} catch (err) {
			expect(err.message).toBe('throwing on index 0');
		}
		await delay(300);
		expect(input.index).toBe(1);
		expect(mappedValues).toEqual([]);
	});

	// NOTE(joel): The 2nd iterable item throwing is distinct from the 1st when
	// concurrency is 1 because it means that the source next() is invoked from
	// next() and not from the constructor.
	test('catches exception from source iterator - 2nd item', async () => {
		const input = new ThrowingIterator(100, 1);
		const mappedValues = [];
		try {
			await pMap(
				input,
				async value => {
					mappedValues.push(value);
					await delay(100);
					return value;
				},
				{ concurrency: 1, stopOnError: true },
			);
		} catch (err) {
			expect(err.message).toBe('throwing on index 1');
		}
		await delay(300);
		expect(input.index).toBe(2);
		expect(mappedValues).toEqual([0]);
	});

	// NOTE(joel): The 2nd iterable item throwing after a 1st item mapper
	// exception, with stopOnError false, is distinct from other cases because
	// our next() is called from a catch block.
	test('catches exception from source iterator - 2nd item after 1st item mapper throw', async () => {
		const input = new ThrowingIterator(100, 1);
		const mappedValues = [];
		try {
			await pMap(
				input,
				async value => {
					mappedValues.push(value);
					await delay(100);
					throw new Error('mapper threw error');
				},
				{ concurrency: 1, stopOnError: false },
			);
		} catch (err) {
			expect(err.message).toBe('throwing on index 1');
		}
		await delay(300);
		expect(input.index).toBe(2);
		expect(mappedValues).toEqual([0]);
	});

	test('incorrect input type', async () => {
		let mapperCalled = false;

		try {
			await pMap(123456, async () => {
				mapperCalled = true;
				await delay(100);
			});
		} catch (err) {
			expect(err.message).toBe(
				'Expected `input` to be either an `Iterable` or `AsyncIterable`, got (number)',
			);
		}

		expect(mapperCalled).toBe(false);
	});

	test('no unhandled rejected promises from mapper throws - infinite concurrency', async () => {
		const input = [1, 2, 3];
		const mappedValues = [];

		try {
			await pMap(input, async value => {
				mappedValues.push(value);
				await delay(100);
				throw new Error(`Oops! ${value}`);
			});
		} catch (err) {
			expect(err.message).toBe('Oops! 1');
		}

		// NOTE(joel): All 3 mappers get invoked, all 3 throw, even with `
		// {stopOnError: true}` this should raise an AggregateError with all 3
		// exceptions instead of throwing 1 exception and hiding the other 2.
		expect(mappedValues).toEqual([1, 2, 3]);
	});

	test('no unhandled rejected promises from mapper throws - concurrency 1', async () => {
		const input = [1, 2, 3];
		const mappedValues = [];

		try {
			await pMap(
				input,
				async value => {
					mappedValues.push(value);
					await delay(100);
					throw new Error(`Oops! ${value}`);
				},
				{ concurrency: 1 },
			);
		} catch (err) {
			expect(err.message).toBe('Oops! 1');
		}

		expect(mappedValues).toEqual([1]);
	});
});
