
# ModelError

A Python exception raised during execution.

## Properties

Name | Type
------------ | -------------
`value` | string
`traceback` | Array&lt;string&gt;
`name` | string

## Example

```typescript
import type { ModelError } from ''

// TODO: Update the object below with actual values
const example = {
  "value": null,
  "traceback": null,
  "name": null,
} satisfies ModelError

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ModelError
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


