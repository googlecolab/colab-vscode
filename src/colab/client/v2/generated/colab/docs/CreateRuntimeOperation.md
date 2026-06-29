
# CreateRuntimeOperation

This resource represents a long-running operation where metadata and response fields are strongly typed.

## Properties

Name | Type
------------ | -------------
`name` | string
`error` | [Status](Status.md)
`done` | boolean
`metadata` | [CreateRuntimeMetadata](CreateRuntimeMetadata.md)
`response` | [Runtime](Runtime.md)

## Example

```typescript
import type { CreateRuntimeOperation } from ''

// TODO: Update the object below with actual values
const example = {
  "name": null,
  "error": null,
  "done": null,
  "metadata": null,
  "response": null,
} satisfies CreateRuntimeOperation

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as CreateRuntimeOperation
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


