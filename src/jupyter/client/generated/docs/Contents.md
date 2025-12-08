
# Contents

A contents object.  The content and format keys may be null if content is not contained. The hash maybe null if hash is not required.  If type is \'file\', then the mimetype will be null.

## Properties

Name | Type
------------ | -------------
`name` | string
`path` | string
`type` | string
`writable` | boolean
`created` | string
`lastModified` | string
`size` | number
`mimetype` | string
`content` | string
`format` | string
`hash` | string
`hashAlgorithm` | string

## Example

```typescript
import type { Contents } from ''

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "path": null,
  "type": null,
  "writable": null,
  "created": null,
  "lastModified": null,
  "size": null,
  "mimetype": null,
  "content": null,
  "format": null,
  "hash": null,
  "hashAlgorithm": null,
} satisfies Contents

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Contents
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


