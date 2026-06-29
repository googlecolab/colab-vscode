
# Runtime

A Colab managed runtime.

## Properties

Name | Type
------------ | -------------
`connectionInfo` | [ConnectionInfo](ConnectionInfo.md)
`runtimeSpec` | [Key](Key.md)
`name` | string

## Example

```typescript
import type { Runtime } from ''

// TODO: Update the object below with actual values
const example = {
  "connectionInfo": null,
  "runtimeSpec": null,
  "name": null,
} satisfies Runtime

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Runtime
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


