
# ListRuntimesResponse

Response message for `ListRuntimes`.

## Properties

Name | Type
------------ | -------------
`runtimes` | [Array&lt;Runtime&gt;](Runtime.md)

## Example

```typescript
import type { ListRuntimesResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "runtimes": null,
} satisfies ListRuntimesResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListRuntimesResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


