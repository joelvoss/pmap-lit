# pmap-lit

This package is a helper to run promise-returning and async functions multiple
times with different inputs concurrently.

It let's you control concurrency as well as decide wether or not to stop
iteration on errors.

## Requirements

- Node v12+

## Installation

```bash
$ npm i pmap-lit
# or
$ yarn add pmap-lit
```

## Usage

```js
import { pMap } from 'pmap-lit';

const iterable = [
	Promise.resolve('https://cloud.google.com/'),
	'https://aws.amazon.com/',
	'https://azure.microsoft.com/',
];

const results = await pMap(
	iterable,
	async (site) => {
		const { url } = await fetch(site);
		return url;
	},
	{ concurrency: 2 }
);

console.log(result);
// ➞ ['https://cloud.google.com/', 'https://aws.amazon.com/', 'https://azure.microsoft.com/']
```

## API

## Development

(1) Install dependencies

```bash
$ npm i
# or
$ yarn
```

(2) Run initial validation

```bash
$ ./Taskfile.sh validate
```

(3) Start developing. See [`./Taskfile.sh`](./Taskfile.sh) for more tasks to
help you develop.

---

_This project was set up by @jvdx/core_
