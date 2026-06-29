
# ListOperationsResponse

The response message for Operations.ListOperations.

## Properties

Name | Type
------------ | -------------
`operations` | [Array&lt;Operation&gt;](Operation.md)
`unreachable` | Array&lt;string&gt;
`nextPageToken` | string

## Example

```typescript
import type { ListOperationsResponse } from ''

// TODO: Update the object below with actual values
const example = {
  "operations": null,
  "unreachable": null,
  "nextPageToken": null,
} satisfies ListOperationsResponse

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ListOperationsResponse
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


