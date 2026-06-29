
# Operation

This resource represents a long-running operation that is the result of a network API call.

## Properties

Name | Type
------------ | -------------
`error` | [Status](Status.md)
`name` | string
`done` | boolean
`metadata` | { [key: string]: any; }
`response` | { [key: string]: any; }

## Example

```typescript
import type { Operation } from ''

// TODO: Update the object below with actual values
const example = {
  "error": null,
  "name": null,
  "done": null,
  "metadata": null,
  "response": null,
} satisfies Operation

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Operation
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


