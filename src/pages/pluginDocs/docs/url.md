# acode.require('Url')

This acode api provides various utility functions to work with `URLs`. The module have several methods, as described below:

## Usage

```javascript
// add this in top of your plugin main file
const Url = acode.require('Url');
```

## basename(url: string): string | null

This method takes a URL string as input and returns the basename of the last segment of the path, or `null` if the input is invalid. The basename is the filename at the end of the URL path,

for example:
`'index.html'` in `'ftp://localhost/foo/bar/index.html'`.

**Usage :**

```javascript
const basename = Url.basename('ftp://localhost/foo/bar/index.html');
// output: 'index.html'
```

## areSame(...urls: string[]): boolean

This method takes any number of URL strings as input and returns `true` if they are all the same, `false` otherwise. This method compares the URLs.

**Usage :**

```javascript
const areSame = Url.areSame(['https://example.com', 'https://example.com']);
// output: true
```

## extname(url: string): string | null

This method takes a **URL string** as input and returns the file extension of the last segment of the path, or `null` if the input is invalid. The file extension is the characters after the last . character in the basename of the URL,

for example: `'.html'` in `'ftp://localhost/foo/bar/index.html'`.

**Usage :**

```javascript
const extname = Url.extname('ftp://localhost/foo/bar/index.html');
// output: '.html'
```

## join(...pathNames: string[]): string

This method takes any number of path strings as input and returns a joined URL string.

**Usage :**

```javascript
const join = Url.join(['https://example.com', '/foo', '/bar']);
// output: 'https://example.com/foo/bar'
```

## safe(url: string): string

This method takes a URL string as input and returns a URL-safe string by encoding each component of the URL. This method encodes all characters except for alphanumeric characters and the characters `-_.~`. The resulting URL is safe to use in HTTP requests.

**Usage :**

```javascript
const safe = Url.safe(
  'https://www.example.com/path/to/file.html?query=string#hash'
);
// output: 'https://www.example.com/path/to/file.html%3Fquery%3Dstring%23hash'
```

## pathname(url: string): string | null

This method takes a URL string as input and returns the path of the URL, or `null` if the input is invalid. The path is the part of the URL after the protocol and domain name, for example, `'/foo/bar'` in `'ftp://myhost.com/foo/bar'`.

**Usage :**

```javascript
const pathname = Url.pathname('ftp://myhost.com/foo/bar/index.html');
// output: '/foo/bar'
```

## dirname(url: string): string | null

This method takes a URL string as input and returns dir name from the URL, or `null` if the input is invalid. for example, `'ftp://localhost/foo/'` from `'ftp://localhost/foo/bar'`.

**Usage :**

```javascript
const dirname = Url.dirname('ftp://localhost/foo/bar');
// output: 'ftp://localhost/foo/'
```

## parse(url: string): URLObject

Parses the given URL and returns an object that contains the URL and query string.

## formate(urlObj)

Formats a URL object into a string.

### urlObj: Object

An object that represents a URL. It must contain the following properties:

- `protocol:` A string that represents the protocol used in the URL. It can be either `ftp:`, `sftp:`, `http:`, or `https:`.
- `hostname:` A string or number that represents the hostname used in the URL.
- `path:` A string that represents the path used in the URL.
- `username:` A string that represents the username used in the URL.
- `password:` A string that represents the password used in the URL.
- `port:` A string or number that represents the port used in the URL.
- `query:` An object that represents the query string used in the URL.

## getProtocol(url: string): `"ftp:"|"sftp:"|"http:"|"https:"`

Returns protocol of a url e.g. `'ftp:'` from `'ftp://localhost/foo/bar'`

## hidePassword(url: string)

This method takes in a `url` string as input and returns a modified string where the password (if present) is replaced with asterisks `(*)`.
